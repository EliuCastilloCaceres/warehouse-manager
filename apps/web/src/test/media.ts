type Listener = () => void;

const lists = new Set<{ query: string; listeners: Set<Listener> }>();

function evaluate(query: string): boolean {
  const min = /\(min-width:\s*(\d+)px\)/.exec(query);
  const max = /\(max-width:\s*(\d+)px\)/.exec(query);
  const width = window.innerWidth;
  return (!min || width >= Number(min[1])) && (!max || width <= Number(max[1]));
}

/** `matchMedia` simulado que evalúa `min-width`/`max-width` contra `window.innerWidth`. */
export function installMatchMedia(): void {
  window.matchMedia = (query: string) => {
    const entry = { query, listeners: new Set<Listener>() };
    lists.add(entry);
    return {
      get matches() {
        return evaluate(query);
      },
      media: query,
      onchange: null,
      addEventListener: (_type: string, listener: Listener) => entry.listeners.add(listener),
      removeEventListener: (_type: string, listener: Listener) => entry.listeners.delete(listener),
      addListener: (listener: Listener) => entry.listeners.add(listener),
      removeListener: (listener: Listener) => entry.listeners.delete(listener),
      dispatchEvent: () => true,
    } as unknown as MediaQueryList;
  };
}

/** Cambia el ancho de la ventana y avisa a los `matchMedia` suscritos. */
export function setScreenWidth(width: number): void {
  window.innerWidth = width;
  for (const entry of lists) entry.listeners.forEach((listener) => listener());
}
