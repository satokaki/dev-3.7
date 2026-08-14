import React, { useState, useEffect, useRef, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { useToast } from '@/components/ui/use-toast';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Send, Plus, MessageSquare, Bot, User as UserIcon, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { cn } from '@/lib/utils';

const AGENT_NAME = 'labpro_assistant';

const FAQ_SUGGESTIONS = [
  'Bagaimana alur produksi dari resep sampai jual?',
  'Pita cukai dimasukkan ke Master Bahan atau Master Barang?',
  'Kenapa kategori tidak muncul saat tambah bahan?',
  'Kenapa produksi gagal posting?',
  'Kenapa HPP produk saya nol?',
  'Produk tidak bisa dijual, kenapa?',
  'Cara catat pelunasan piutang?',
  'Cara tambah user baru?',
  'Cara backup database?',
  'Resep tidak muncul untuk brewer, kenapa?',
];

function MessageBubble({ message }) {
  const isUser = message.role === 'user';
  return (
    <div className={cn('flex gap-2.5', isUser ? 'flex-row-reverse' : 'flex-row')}>
      <div className={cn('w-7 h-7 rounded-full flex items-center justify-center shrink-0', isUser ? 'bg-primary text-primary-foreground' : 'bg-muted border border-border')}>
        {isUser ? <UserIcon className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
      </div>
      <div className={cn('rounded-lg px-3 py-2 max-w-[85%] text-[13px] leading-relaxed', isUser ? 'bg-primary text-primary-foreground' : 'bg-muted border border-border')}>
        {message.content ? (
          isUser ? <p className="whitespace-pre-wrap">{message.content}</p>
            : <div className="prose prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-li:my-0 prose-headings:my-1.5 prose-pre:bg-background/60 prose-pre:text-xs"><ReactMarkdown>{message.content}</ReactMarkdown></div>
        ) : null}
        {message.tool_calls?.map((tc, i) => (
          <div key={i} className="mt-1.5 text-[11px] flex items-center gap-1.5 opacity-70">
            <Loader2 className={cn('w-3 h-3', (tc.status === 'completed' || tc.status === 'success') && 'hidden')} />
            <span className="font-mono">{tc.name}</span>
            <span>· {tc.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Assistant() {
  const { toast } = useToast();
  const [conversations, setConversations] = useState([]);
  const [currentId, setCurrentId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loadingList, setLoadingList] = useState(true);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef(null);

  const loadConversations = useCallback(async () => {
    setLoadingList(true);
    try {
      const list = await base44.agents.listConversations({ agent_name: AGENT_NAME });
      setConversations(list || []);
    } catch { /* ignore */ }
    finally { setLoadingList(false); }
  }, []);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  useEffect(() => {
    if (!currentId) { setMessages([]); return; }
    const unsub = base44.agents.subscribeToConversation(currentId, (data) => {
      setMessages(data.messages || []);
    });
    // load initial
    base44.agents.getConversation(currentId).then(c => setMessages(c.messages || [])).catch(() => {});
    return () => unsub();
  }, [currentId]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const createConversation = async () => {
    const conv = await base44.agents.createConversation({ agent_name: AGENT_NAME, metadata: { name: 'Bantuan Operasi' } });
    const id = conv.id || conv._id;
    setCurrentId(id);
    setMessages([]);
    loadConversations();
    return id;
  };

  const newConversation = async () => {
    try { await createConversation(); }
    catch (e) { toast({ variant: 'destructive', title: 'Gagal membuat percakapan', description: e.message }); }
  };

  const send = async (overrideText) => {
    const text = (overrideText ?? input).trim();
    if (!text || sending) return;
    setInput('');
    setSending(true);
    try {
      let id = currentId;
      if (!id) id = await createConversation();
      const conv = await base44.agents.getConversation(id);
      await base44.agents.addMessage(conv, { role: 'user', content: text });
    } catch (e) { toast({ variant: 'destructive', title: 'Gagal mengirim', description: e.message }); setInput(text); }
    finally { setSending(false); }
  };

  const askFaq = (q) => send(q);

  const onKeyDown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };

  return (
    <div className="p-5 max-w-[1400px] mx-auto">
      <PageHeader title="Asisten Operasi" description="Tanya cara mengoperasikan LAB PRO — resep, produksi, stok, cukai, penjualan, HPP, dll." />

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4 h-[calc(100dvh-180px)] min-h-[420px]">
        {/* Sidebar conversations */}
        <div className="border border-border rounded-lg bg-card flex flex-col overflow-hidden">
          <div className="p-2.5 border-b border-border">
            <Button onClick={newConversation} size="sm" className="w-full gap-1.5 h-9"><Plus className="w-4 h-4" /> Percakapan Baru</Button>
          </div>
          <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
            {loadingList ? (
              <div className="flex items-center justify-center py-6"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
            ) : conversations.length === 0 ? (
              <p className="text-[12px] text-muted-foreground text-center py-6 px-2">Belum ada percakapan. Mulai dengan baru.</p>
            ) : conversations.map(c => {
              const id = c.id || c._id;
              return (
                <button key={id} onClick={() => setCurrentId(id)} className={cn('w-full text-left px-2.5 py-2 rounded-md text-[12.5px] flex items-center gap-2 transition-colors', id === currentId ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50')}>
                  <MessageSquare className="w-3.5 h-3.5 shrink-0 opacity-60" />
                  <span className="truncate">{c.metadata?.name || 'Percakapan'}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Chat area */}
        <div className="border border-border rounded-lg bg-card flex flex-col overflow-hidden">
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3.5">
            {!currentId || messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center px-6 gap-4">
                <Bot className="w-10 h-10 opacity-40 text-muted-foreground" />
                <div>
                  <p className="text-[13px] font-medium text-foreground">Halo! Saya Asisten Operasi LAB PRO.</p>
                  <p className="text-[12px] text-muted-foreground mt-1">Pilih pertanyaan di bawah atau ketik sendiri untuk mulai.</p>
                </div>
                <div className="flex flex-col gap-1.5 w-full max-w-sm">
                  {FAQ_SUGGESTIONS.map((q) => (
                    <button
                      key={q}
                      onClick={() => askFaq(q)}
                      disabled={sending}
                      className="text-left text-[12.5px] px-3 py-2 rounded-lg border border-border bg-muted/40 hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-50"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map(m => <MessageBubble key={m.id || m._id || Math.random()} message={m} />)
            )}
          </div>
          <div className="border-t border-border p-2.5 flex gap-2">
            <Input value={input} onChange={e => setInput(e.target.value)} onKeyDown={onKeyDown} placeholder="Tanya apa saja tentang operasi LAB PRO…" className="h-10 text-[13px]" disabled={sending} />
            <Button onClick={send} disabled={sending || !input.trim()} size="icon" className="h-10 w-10 shrink-0">
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}