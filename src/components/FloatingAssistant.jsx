import React, { useState, useEffect, useRef, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Send, Bot, User as UserIcon, Loader2, X, MessageCircle, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { cn } from '@/lib/utils';

const AGENT_NAME = 'labpro_assistant';

const FAQ_SUGGESTIONS = [
  'Bagaimana alur produksi dari resep sampai jual?',
  'Berapa stok bahan yang ada sekarang?',
  'Kenapa HPP produk saya nol?',
  'Cara catat pelunasan piutang?',
];

function MessageBubble({ message }) {
  const isUser = message.role === 'user';
  return (
    <div className={cn('flex gap-2', isUser ? 'flex-row-reverse' : 'flex-row')}>
      <div className={cn('w-6 h-6 rounded-full flex items-center justify-center shrink-0', isUser ? 'bg-primary text-primary-foreground' : 'bg-muted border border-border')}>
        {isUser ? <UserIcon className="w-3 h-3" /> : <Bot className="w-3 h-3" />}
      </div>
      <div className={cn('rounded-lg px-2.5 py-1.5 max-w-[82%] text-[12.5px] leading-relaxed', isUser ? 'bg-primary text-primary-foreground' : 'bg-muted border border-border')}>
        {message.content ? (
          isUser ? <p className="whitespace-pre-wrap">{message.content}</p>
            : <div className="prose prose-sm max-w-none prose-p:my-0.5 prose-ul:my-0.5 prose-li:my-0 prose-headings:my-1 prose-pre:bg-background/60 prose-pre:text-[11px]"><ReactMarkdown>{message.content}</ReactMarkdown></div>
        ) : null}
        {message.tool_calls?.map((tc, i) => (
          <div key={i} className="mt-1 text-[10px] flex items-center gap-1 opacity-60">
            <Loader2 className={cn('w-2.5 h-2.5', (tc.status === 'completed' || tc.status === 'success') && 'hidden')} />
            <span className="font-mono">{tc.name}</span>
            <span>· {tc.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function FloatingAssistant() {
  const [open, setOpen] = useState(false);
  const [showBubble, setShowBubble] = useState(false);
  const [currentId, setCurrentId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef(null);
  const bubbleTimer = useRef(null);
  const [pos, setPos] = useState(null);
  const dragRef = useRef({ active: false, moved: false, startX: 0, startY: 0, originX: 0, originY: 0 });
  const btnRef = useRef(null);

  useEffect(() => {
    bubbleTimer.current = setTimeout(() => setShowBubble(true), 1500);
    return () => clearTimeout(bubbleTimer.current);
  }, []);

  const onPointerDown = (e) => {
    const btn = btnRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    dragRef.current = { active: true, moved: false, startX: e.clientX, startY: e.clientY, originX: rect.left, originY: rect.top };
    btn.setPointerCapture?.(e.pointerId);
  };

  useEffect(() => {
    const onMove = (e) => {
      const d = dragRef.current;
      if (!d.active) return;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (!d.moved && Math.hypot(dx, dy) > 6) d.moved = true;
      if (d.moved) {
        const size = 56;
        const x = Math.min(Math.max(8, d.originX + dx), window.innerWidth - size - 8);
        const y = Math.min(Math.max(8, d.originY + dy), window.innerHeight - size - 8);
        setPos({ x, y });
      }
    };
    const onUp = () => { dragRef.current.active = false; };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  useEffect(() => {
    if (!currentId) { setMessages([]); return; }
    const unsub = base44.agents.subscribeToConversation(currentId, (data) => {
      setMessages(data.messages || []);
    });
    base44.agents.getConversation(currentId).then(c => setMessages(c.messages || [])).catch(() => {});
    return () => unsub();
  }, [currentId]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const createConversation = useCallback(async () => {
    const conv = await base44.agents.createConversation({ agent_name: AGENT_NAME, metadata: { name: 'Bantuan Operasi' } });
    const id = conv.id || conv._id;
    setCurrentId(id);
    setMessages([]);
    return id;
  }, []);

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
    } catch { setInput(text); }
    finally { setSending(false); }
  };

  const onKeyDown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };

  const toggleOpen = () => {
    setOpen(o => !o);
    setShowBubble(false);
  };

  return (
    <div className="fixed z-50 print:hidden" style={pos ? { left: pos.x, top: pos.y } : { right: '1rem', bottom: '1rem' }}>
      {/* Mini chat panel */}
      {open && (
        <div className="absolute bottom-16 right-0 w-[calc(100vw-2rem)] sm:w-[380px] h-[min(560px,calc(100vh-7rem))] bg-white border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden animate-in">
          {/* Header */}
          <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-border bg-primary text-primary-foreground">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-primary-foreground/15 flex items-center justify-center">
                <Bot className="w-4 h-4" />
              </div>
              <div>
                <div className="text-[13px] font-semibold leading-none">Asisten Operasi</div>
                <div className="text-[10px] opacity-80 mt-0.5 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400" /> Online
                </div>
              </div>
            </div>
            <button onClick={toggleOpen} className="p-1.5 hover:bg-primary-foreground/10 rounded-md transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2.5 bg-slate-50">
            {(!currentId || messages.length === 0) ? (
              <div className="h-full flex flex-col items-center justify-center text-center px-4 gap-3">
                <div className="w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center">
                  <Sparkles className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="text-[13px] font-medium text-foreground">Halo! Saya siap bantu operasi LAB PRO.</p>
                  <p className="text-[11.5px] text-muted-foreground mt-1">Tanya soal stok, barang, produksi, atau cara pakai aplikasi.</p>
                </div>
                <div className="flex flex-col gap-1.5 w-full">
                  {FAQ_SUGGESTIONS.map((q) => (
                    <button
                      key={q}
                      onClick={() => send(q)}
                      disabled={sending}
                      className="text-left text-[12px] px-2.5 py-1.5 rounded-lg border border-border bg-white hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-50"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map(m => <MessageBubble key={m.id || m._id || Math.random()} message={m} />)
            )}
            {sending && messages.length > 0 && (
              <div className="flex gap-2">
                <div className="w-6 h-6 rounded-full bg-muted border border-border flex items-center justify-center"><Bot className="w-3 h-3" /></div>
                <div className="rounded-lg px-2.5 py-2 bg-muted border border-border">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="border-t border-border p-2.5 flex gap-2 bg-white">
            <Input value={input} onChange={e => setInput(e.target.value)} onKeyDown={onKeyDown} placeholder="Tanya apa saja…" className="h-9 text-[12.5px]" disabled={sending} />
            <Button onClick={() => send()} disabled={sending || !input.trim()} size="icon" className="h-9 w-9 shrink-0">
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      )}

      {/* Bubble text */}
      {showBubble && !open && (
        <div className="absolute bottom-3 right-16 animate-in fade-in slide-in-from-right-2">
          <div className="bg-white border border-border shadow-lg rounded-xl px-3 py-2 flex items-center gap-2">
            <p className="text-[12.5px] font-medium text-foreground whitespace-nowrap">Aku siap membantumu 👋</p>
            <button onClick={() => setShowBubble(false)} className="text-muted-foreground hover:text-foreground">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Floating button */}
      <button
        ref={btnRef}
        onPointerDown={onPointerDown}
        onClick={() => { if (!dragRef.current.moved) toggleOpen(); }}
        className={cn(
          'w-14 h-14 rounded-full shadow-xl flex items-center justify-center transition-all duration-200 hover:scale-105 touch-none select-none cursor-grab active:cursor-grabbing',
          open ? 'bg-muted text-foreground border border-border' : 'bg-primary text-primary-foreground'
        )}
        aria-label="Asisten AI"
      >
        {open ? <X className="w-6 h-6" /> : <MessageCircle className="w-6 h-6" />}
      </button>
    </div>
  );
}