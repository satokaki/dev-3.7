import React, { useState, useMemo } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command';
import { Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';

const mcLabel = {
  flavor: 'Flavor', propylene_glycol: 'PG', vegetable_glycerin: 'VG', nicotine: 'Nicotine',
  sweetener: 'Sweetener', cooling: 'Cooling', additive: 'Additive', premix: 'Premix', lainnya: 'Lainnya',
};

/**
 * Searchable combobox for picking a recipe ingredient.
 * - Filters by material name, code, or category (case-insensitive).
 * - Max 20 results shown.
 * - Materials already selected on other rows are disabled with "Sudah dipilih".
 * - Keyboard navigation is provided by cmdk (Command).
 */
export default function RecipeIngredientPicker({
  materials = [],
  value,
  onChange,
  excludeIds = [],
  placeholder = 'Cari bahan resep...',
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = materials.find((m) => m.id === value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = materials;
    if (q) {
      list = materials.filter((m) =>
        (m.name || '').toLowerCase().includes(q) ||
        (m.code || '').toLowerCase().includes(q) ||
        (m.material_category || '').toLowerCase().includes(q) ||
        (mcLabel[m.material_category] || '').toLowerCase().includes(q)
      );
    }
    return list.slice(0, 20);
  }, [materials, query]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          className={cn(
            'flex h-8 w-full items-center justify-between rounded-md border border-input bg-transparent px-2 text-[12px] text-left hover:bg-accent focus:outline-none focus:ring-1 focus:ring-ring',
            !selected && 'text-muted-foreground'
          )}
        >
          <span className="truncate">
            {selected ? `${selected.code || ''} · ${selected.name}` : placeholder}
          </span>
          <ChevronsUpDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder={placeholder} value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>Tidak ditemukan</CommandEmpty>
            <CommandGroup>
              {filtered.map((m) => {
                const used = excludeIds.includes(m.id);
                return (
                  <CommandItem
                    key={m.id}
                    value={`${m.code || ''} ${m.name}`}
                    disabled={used}
                    onSelect={() => {
                      if (!used) {
                        onChange(m.id);
                        setOpen(false);
                        setQuery('');
                      }
                    }}
                    className="text-[12px]"
                  >
                    <div className="flex flex-1 min-w-0 flex-col">
                      <span className="truncate">{m.code || ''} · {m.name}</span>
                      <span className="text-[10px] text-muted-foreground">
                        Kategori: {mcLabel[m.material_category] || m.material_category || '—'}
                      </span>
                    </div>
                    {used && <span className="ml-2 shrink-0 text-[10px] text-amber-600">Sudah dipilih</span>}
                    {value === m.id && <Check className="ml-1 h-3.5 w-3.5 shrink-0" />}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}