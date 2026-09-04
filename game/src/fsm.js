// The only way the game changes screen. Transitions are declared, illegal ones
// throw instead of silently half-working, and enter/exit hooks fire exactly once.
export function createMachine({ initial, states, onChange }) {
  let current = null;
  let context = {};

  function assertKnown(name) {
    if (!states[name]) throw new Error(`unknown state: ${name}`);
  }

  function set(name, payload = {}) {
    assertKnown(name);
    if (name === current) return current;

    const from = current;
    const allowed = from ? states[from].to : null;
    if (allowed && !allowed.includes(name)) {
      throw new Error(`illegal transition: ${from} -> ${name}`);
    }

    if (from && states[from].exit) states[from].exit(context);
    current = name;
    context = payload;
    if (states[name].enter) states[name].enter(context);
    if (onChange) onChange(name, from, context);
    return current;
  }

  set(initial);

  return {
    get state() { return current; },
    get context() { return context; },
    is: (name) => current === name,
    can: (name) => !current || !states[current].to || states[current].to.includes(name),
    set
  };
}
