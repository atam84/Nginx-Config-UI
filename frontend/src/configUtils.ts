import type { ConfigFile, Node } from './api'

/** Set or update a directive in a block. Replaces existing or appends. Empty args removes. */
export function setBlockDirective(directives: Node[], name: string, args: string[]): Node[] {
  const rest = directives.filter((d) => d.name !== name)
  const hasValue = args.some((a) => a.trim() !== '')
  if (hasValue) {
    return [...rest, { type: 'directive' as const, name, args, enabled: true }]
  }
  return rest
}

/** Remove a directive from a block. */
export function removeBlockDirective(directives: Node[], name: string): Node[] {
  return directives.filter((d) => d.name !== name)
}

/** Replace all directives with given name (for multi-value like proxy_set_header). */
export function setBlockDirectivesMulti(
  directives: Node[],
  name: string,
  items: { args: string[] }[]
): Node[] {
  const rest = directives.filter((d) => d.name !== name)
  const newOnes = items
    .filter((item) => item.args.some((a) => a.trim() !== ''))
    .map((item) => ({
      type: 'directive' as const,
      name,
      args: item.args,
      enabled: true,
    }))
  return [...rest, ...newOnes]
}

/** Insert an upstream block into the http block. */
export function addUpstreamToConfig(config: ConfigFile, upstream: Node): ConfigFile {
  const dirs = config.directives ?? []
  for (let i = 0; i < dirs.length; i++) {
    if (dirs[i].name === 'http' && dirs[i].type === 'block') {
      const http = { ...dirs[i], directives: [...(dirs[i].directives ?? []), upstream] }
      return { ...config, directives: [...dirs.slice(0, i), http, ...dirs.slice(i + 1)] }
    }
  }
  const http: Node = {
    type: 'block',
    name: 'http',
    args: [],
    enabled: true,
    directives: [upstream],
  }
  return { ...config, directives: [...dirs, http] }
}

/** Insert a server block into the http block. */
export function addServerToConfig(config: ConfigFile, server: Node): ConfigFile {
  const dirs = config.directives ?? []
  for (let i = 0; i < dirs.length; i++) {
    if (dirs[i].name === 'http' && dirs[i].type === 'block') {
      const http = { ...dirs[i], directives: [...(dirs[i].directives ?? []), server] }
      return { ...config, directives: [...dirs.slice(0, i), http, ...dirs.slice(i + 1)] }
    }
  }
  const http: Node = {
    type: 'block',
    name: 'http',
    args: [],
    enabled: true,
    directives: [server],
  }
  return { ...config, directives: [...dirs, http] }
}

/** Get block position within parent for move up/down. */
export function getBlockPosition(config: ConfigFile, nodeId: string | undefined): { index: number; total: number } | null {
  const found = findParentOf(config, nodeId)
  if (!found) return null
  const arr = found.type === 'top' ? found.directives : found.siblingDirectives
  return { index: found.index, total: arr.length }
}

type ParentRef =
  | { type: 'nested'; parent: Node; index: number; siblingDirectives: Node[] }
  | { type: 'top'; index: number; directives: Node[] }

/** Find parent of node by id. */
function findParentOf(config: ConfigFile, nodeId: string | undefined): ParentRef | null {
  if (!nodeId) return null

  const topLevel = config.directives ?? []
  for (let i = 0; i < topLevel.length; i++) {
    if (topLevel[i].id === nodeId) return { type: 'top', index: i, directives: topLevel }
  }
  function search(nodes: Node[], parent: Node): ParentRef | null {
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].id === nodeId) return { type: 'nested', parent, index: i, siblingDirectives: nodes }
      if (nodes[i].directives?.length) {
        const found = search(nodes[i].directives!, nodes[i])
        if (found) return found
      }
    }
    return null
  }
  for (const n of topLevel) {
    if (n.directives?.length) {
      const found = search(n.directives, n)
      if (found) return found
    }
  }
  return null
}

function applyParentUpdate(config: ConfigFile, ref: ParentRef, newDirectives: Node[]): ConfigFile {
  if (ref.type === 'top') {
    return { ...config, directives: newDirectives }
  }
  return replaceNodeById(config, ref.parent.id, (p) => ({ ...p, directives: newDirectives }))
}

/** Move a node within its parent's directives. */
export function moveNodeInParent(
  config: ConfigFile,
  nodeId: string | undefined,
  direction: 'up' | 'down'
): ConfigFile {
  const found = findParentOf(config, nodeId)
  if (!found) return config
  const arr = found.type === 'top' ? [...found.directives] : [...found.siblingDirectives]
  const index = found.index
  const newIdx = direction === 'up' ? index - 1 : index + 1
  if (newIdx < 0 || newIdx >= arr.length) return config
  ;[arr[index], arr[newIdx]] = [arr[newIdx], arr[index]]
  return applyParentUpdate(config, found, arr)
}

/** Duplicate a node (sibling after original). */
export function duplicateNode(config: ConfigFile, nodeId: string | undefined): ConfigFile {
  const found = findParentOf(config, nodeId)
  if (!found) return config
  const arr = found.type === 'top' ? [...found.directives] : [...found.siblingDirectives]
  const original = arr[found.index]
  const copy = cloneNode(original)
  copy.id = `dup-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  arr.splice(found.index + 1, 0, copy)
  return applyParentUpdate(config, found, arr)
}

/** Remove a node from the tree. */
export function removeNodeById(config: ConfigFile, nodeId: string | undefined): ConfigFile {
  const found = findParentOf(config, nodeId)
  if (!found) return config
  const arr =
    found.type === 'top' ? found.directives.filter((_, i) => i !== found.index) : found.siblingDirectives.filter((_, i) => i !== found.index)
  return applyParentUpdate(config, found, arr)
}

/** Replace a node in the tree by id. Returns new config. */
export function replaceNodeById(config: ConfigFile, nodeId: string | undefined, updater: (n: Node) => Node): ConfigFile {
  if (!nodeId) return config

  function replaceIn(nodes: Node[]): Node[] {
    return nodes.map((n) => {
      if (n.id === nodeId) return updater({ ...n })
      if (n.directives?.length) {
        return { ...n, directives: replaceIn(n.directives) }
      }
      return n
    })
  }

  return { ...config, directives: replaceIn(config.directives) }
}

/** Clone a node deeply */
export function cloneNode(n: Node): Node {
  return {
    ...n,
    id: undefined,
    directives: n.directives?.map(cloneNode),
  }
}

/** Serialize ConfigFile to Nginx text (matches backend logic) */
export function serializeConfigToText(cfg: ConfigFile): string {
  const indentSpaces = 4

  function serializeNode(n: Node, level: number): string {
    const indent = ' '.repeat(level * indentSpaces)
    const prefix = n.enabled ? '' : '# '
    const args = (n.args ?? []).join(' ').trim()
    const argsPart = args ? ` ${args}` : ''

    if (n.type === 'directive' || !n.directives?.length) {
      return `${indent}${prefix}${n.name}${argsPart};\n`
    }
    let out = `${indent}${prefix}${n.name}${argsPart} {\n`
    for (const c of n.directives) {
      out += serializeNode(c, level + 1)
    }
    out += `${indent}}\n`
    return out
  }

  let out = ''
  for (const n of cfg.directives ?? []) {
    out += serializeNode(n, 0)
  }
  return out
}

/** Simple line diff: returns { added, removed, unchanged } */
export function diffLines(oldText: string, newText: string): { type: 'add' | 'remove' | 'unchanged'; line: string }[] {
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')
  const result: { type: 'add' | 'remove' | 'unchanged'; line: string }[] = []
  let i = 0
  let j = 0
  while (i < oldLines.length || j < newLines.length) {
    if (i >= oldLines.length) {
      result.push({ type: 'add', line: newLines[j++] })
      continue
    }
    if (j >= newLines.length) {
      result.push({ type: 'remove', line: oldLines[i++] })
      continue
    }
    if (oldLines[i] === newLines[j]) {
      result.push({ type: 'unchanged', line: oldLines[i] })
      i++
      j++
    } else {
      const nextOld = oldLines.indexOf(newLines[j], i)
      const nextNew = newLines.indexOf(oldLines[i], j)
      if (nextOld !== -1 && (nextNew === -1 || nextOld - i <= nextNew - j)) {
        while (i < nextOld) {
          result.push({ type: 'remove', line: oldLines[i++] })
        }
      } else if (nextNew !== -1) {
        while (j < nextNew) {
          result.push({ type: 'add', line: newLines[j++] })
        }
      } else {
        result.push({ type: 'remove', line: oldLines[i++] })
        result.push({ type: 'add', line: newLines[j++] })
      }
    }
  }
  return result
}
