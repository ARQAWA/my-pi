import { InteractiveMode, SettingsSelectorComponent, VERSION, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { SettingsList } from "@earendil-works/pi-tui";

const MARK = "rqw-commands:controls-owner";
const STATE = Symbol.for("rqw-commands/controls");
const ACTIONS = ["app.thinking.cycle", "app.model.select", "app.model.cycleForward", "app.model.cycleBackward"];
const HIDDEN = new Set(["cache-warming-mode", "model-thinking", "double-escape-action", "tree-filter-mode"]);
const WARNING = "RQW-commands: incompatible Pi controls internals; controls cleanup is disabled.";
type Fn = (...args: any[]) => any;
type Owner = { token: object; live: () => boolean };
type Policy = { owner: Owner; keybindings: any; descriptor?: PropertyDescriptor; rebuild: Fn; wrapper: Fn; active: boolean };
type State = { owners: Set<Owner>; hosts: Map<any, Policy>; descriptors: Map<string, PropertyDescriptor>; wrappers: Map<string, Fn> };

function owns(host: any, owner: Owner): boolean {
 try { return owner.live() && host.session.resourceLoader.getExtensions().extensions.some((ext: any) => ext.handlers.get(MARK)?.some((fn: Fn) => fn({ type: MARK }) === owner.token)); }
 catch { return false; }
}
function current(state: State, host: any): Policy | undefined {
 const policy = state.hosts.get(host);
 return policy?.active && owns(host, policy.owner) ? policy : undefined;
}
function stop(policy: Policy) {
 policy.active = false;
 const kb = policy.keybindings;
 if (Object.getOwnPropertyDescriptor(kb, "rebuild")?.value === policy.wrapper) {
  if (policy.descriptor) Object.defineProperty(kb, "rebuild", policy.descriptor);
  else delete kb.rebuild;
 }
 kb.rebuild();
}
function fail(state: State, host: any) {
 const policy = state.hosts.get(host);
 if (policy) { state.hosts.delete(host); stop(policy); }
 host.showWarning?.(WARNING);
}
function bind(state: State, host: any, owner: Owner) {
 const prior = state.hosts.get(host);
 if (prior && prior.owner === owner && prior.keybindings === host.keybindings && prior.active) return;
 if (prior) { state.hosts.delete(host); stop(prior); }
 const kb = host.keybindings;
 const descriptor = kb && Object.getOwnPropertyDescriptor(kb, "rebuild");
 if (!(kb?.keysById instanceof Map) || ["rebuild", "matches", "getKeys", "getResolvedBindings"].some(name => typeof kb[name] !== "function") ||
  (descriptor && (!descriptor.configurable || !descriptor.writable)) || (!descriptor && !Object.isExtensible(kb)) || ACTIONS.some(id => !kb.keysById.has(id))) throw new Error(WARNING);
 const rebuild = kb.rebuild as Fn;
 const policy: Policy = { owner, keybindings: kb, descriptor, rebuild, active: true, wrapper: () => {} };
 policy.wrapper = function(this: any, ...args: unknown[]) {
  const result = rebuild.apply(this, args);
  if (policy.active && owns(host, owner)) for (const id of ACTIONS) kb.keysById.set(id, []);
  return result;
 };
 Object.defineProperty(kb, "rebuild", { configurable: true, writable: true, value: policy.wrapper });
 state.hosts.set(host, policy);
 for (const id of ACTIONS) kb.keysById.set(id, []);
}

export function installControls(pi: ExtensionAPI, registerShutdown = true): () => void {
 if (VERSION !== "1.4.0") throw new Error(WARNING);
 const proto = InteractiveMode.prototype as any;
 let state = proto[STATE] as State | undefined;
 if (!state) {
  const names = ["createBaseAutocompleteProvider", "showSelector", "getLogoutProviderOptions"];
  const descriptors = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(proto, name)]));
  if (names.some(name => { const d = descriptors.get(name); return !d?.configurable || !d.writable || typeof d.value !== "function"; })) throw new Error(WARNING);
  state = { owners: new Set(), hosts: new Map(), descriptors: descriptors as Map<string, PropertyDescriptor>, wrappers: new Map() };
  const s = state;
  const factory = descriptors.get(names[0])!.value as Fn;
  const selector = descriptors.get(names[1])!.value as Fn;
  const logout = descriptors.get(names[2])!.value as Fn;
  s.wrappers.set(names[0], function(this: any, ...args: unknown[]) {
   const result = factory.apply(this, args);
   const owner = [...s.owners].find(candidate => owns(this, candidate));
   if (!owner) { const prior = s.hosts.get(this); if (prior) { s.hosts.delete(this); stop(prior); } return result; }
   try { bind(s, this, owner); } catch { fail(s, this); }
   return result;
  });
  s.wrappers.set(names[1], function(this: any, create: Fn) {
   if (!current(s, this)) return selector.call(this, create);
   const host = this;
   return selector.call(this, (done: Fn) => {
    const created = create(done);
    if (!(created?.component instanceof SettingsSelectorComponent)) return created;
    try {
     const list = created.component.getSettingsList() as any;
     if (!(list instanceof SettingsList)) throw new Error(WARNING);
     const raw: any = list;
     if (!Array.isArray(raw.items) || !Array.isArray(raw.filteredItems) ||
      !Object.getOwnPropertyDescriptor(raw, "items")?.writable || !Object.getOwnPropertyDescriptor(raw, "filteredItems")?.writable ||
      !Object.getOwnPropertyDescriptor(raw, "selectedIndex")?.writable || HIDDEN.size !== raw.items.filter((item: any) => HIDDEN.has(item.id)).length) throw new Error(WARNING);
     const selected = raw.filteredItems[raw.selectedIndex];
     const items = raw.items.filter((item: any) => !HIDDEN.has(item.id));
     const filtered = raw.filteredItems.filter((item: any) => !HIDDEN.has(item.id));
     raw.items = items; raw.filteredItems = filtered;
     raw.selectedIndex = Math.max(0, filtered.indexOf(selected));
    } catch { fail(s, host); }
    return created;
   });
  });
  s.wrappers.set(names[2], async function(this: any, ...args: unknown[]) {
   const result = await logout.apply(this, args);
   if (!current(s, this)) return result;
   try {
    const providers = this.session.modelRuntime.getProviders();
    if (!Array.isArray(result) || !Array.isArray(providers) || result.some((entry: any) => typeof entry.id !== "string") || providers.some((entry: any) => typeof entry.id !== "string")) throw new Error(WARNING);
    const visible = new Set(providers.map((entry: any) => entry.id));
    return result.filter((entry: any) => visible.has(entry.id));
   } catch { fail(s, this); return result; }
  });
  for (const name of names) Object.defineProperty(proto, name, { ...descriptors.get(name), value: s.wrappers.get(name) });
  Object.defineProperty(proto, STATE, { configurable: true, value: s });
 }
 const s = state;
 const token = {};
 let stopped = false;
 const owner: Owner = { token, live: () => {
  if (stopped) return false;
  try { (pi.on("rqw-commands:controls-probe" as "session_start", () => {}) as unknown as (() => void) | undefined)?.(); return true; } catch { return false; }
 } };
 s.owners.add(owner);
 pi.on(MARK as "session_start", (() => token) as () => void);
 const dispose = () => {
  if (stopped) return;
  stopped = true; s.owners.delete(owner);
  for (const [host, policy] of s.hosts) if (policy.owner === owner) { s.hosts.delete(host); stop(policy); }
  if (!s.owners.size) {
   for (const [name, descriptor] of s.descriptors) if (Object.getOwnPropertyDescriptor(proto, name)?.value === s.wrappers.get(name)) Object.defineProperty(proto, name, descriptor);
   if (proto[STATE] === s) delete proto[STATE];
  }
 };
 if (registerShutdown) pi.on("session_shutdown", dispose);
 return dispose;
}
