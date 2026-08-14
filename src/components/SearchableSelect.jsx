import React, { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandInput, CommandList, CommandEmpty, CommandItem, CommandGroup } from '@/components/ui/command';
import { cn } from '@/lib/utils';
import { ChevronsUpDown } from 'lucide-react';

export default function SearchableSelect({ value, onValueChange, options, placeholder, className }) {
  const [open, setOpen] = useState(false);
  const selected = options.find(o => o.value === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className={cn("flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 text-[13px] text-left data-[placeholder]:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring", className)}>
        <span className={cn("truncate", !selected && "text-muted-foreground")}>{selected ? selected.label : (placeholder || 'Pilih...')}</span>
        <ChevronsUpDown className="h-3.5 w-3.5 opacity-50 shrink-0 ml-2" />
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[var(--radix-popover-trigger-width)]" align="start">
        <Command>
          <CommandInput placeholder="Cari nama / kode / kategori..." className="h-8" />
          <CommandList className="max-h-60">
            <CommandEmpty>Tidak ditemukan</CommandEmpty>
            <CommandGroup>
              {options.map(o => (
                <CommandItem
                  key={o.value}
                  value={`${o.label} ${o.keywords || ''}`}
                  onSelect={() => { onValueChange(o.value); setOpen(false); }}
                  className="text-[12.5px]"
                >
                  {o.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}