import { useState } from 'react';
import type { TicketWidth } from '@/shared/ticket/TicketHeader';
import { Button } from '@/shared/ui/button';
import { Checkbox } from '@/shared/ui/checkbox';
import { Label } from '@/shared/ui/label';
import { ResponsiveDialog } from '@/shared/ui/ResponsiveDialog';
import { readTicketSettings, writeTicketSettings } from '../device';

/** "Ajustes del ticket": impresión automática y ancho del papel, solo en este dispositivo. */
export function TicketSettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [settings, setSettings] = useState(readTicketSettings);
  const update = (next: Partial<typeof settings>) => {
    const value = { ...settings, ...next };
    setSettings(value);
    writeTicketSettings(value);
  };
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Ajustes del ticket"
      description="Se guardan en este dispositivo."
    >
      <div className="flex flex-col gap-4 pb-4">
        <div className="flex items-center gap-2">
          <Checkbox
            id="pos-auto-print"
            checked={settings.autoPrint}
            onCheckedChange={(checked) => update({ autoPrint: checked === true })}
          />
          <Label htmlFor="pos-auto-print">Imprimir el ticket al cobrar</Label>
        </div>
        <div role="group" aria-label="Ancho del papel" className="flex items-center gap-2">
          <span className="text-sm">Ancho del papel:</span>
          {([80, 58] as const satisfies readonly TicketWidth[]).map((width) => (
            <Button
              key={width}
              size="sm"
              variant={settings.width === width ? 'default' : 'outline'}
              aria-pressed={settings.width === width}
              onClick={() => update({ width })}
            >
              {width} mm
            </Button>
          ))}
        </div>
      </div>
    </ResponsiveDialog>
  );
}
