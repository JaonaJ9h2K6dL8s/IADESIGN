import type { DesignNode } from './types';

export type LayerDirection = 'up' | 'down';

export function selectObjects(nodes: DesignNode[], selected: string[], id: string, extend = false): string[] {
  const node = nodes.find((item) => item.id === id);
  if (!node) return selected;
  const members = node.groupId ? nodes.filter((item) => item.groupId === node.groupId).map((item) => item.id) : [id];
  if (!extend) return members;
  const allSelected = members.every((member) => selected.includes(member));
  return allSelected ? selected.filter((selectedId) => !members.includes(selectedId)) : [...new Set([...selected, ...members])];
}

export function groupObjects(nodes: DesignNode[], selected: string[], groupId = crypto.randomUUID()): DesignNode[] {
  if (selected.length < 2) return nodes;
  const selectedIds = new Set(selected);
  return nodes.map((node) => selectedIds.has(node.id) ? { ...node, groupId } : node);
}

export function ungroupObjects(nodes: DesignNode[], selected: string[]): DesignNode[] {
  const selectedIds = new Set(selected);
  const groupIds = new Set(nodes.filter((node) => selectedIds.has(node.id) && node.groupId).map((node) => node.groupId));
  if (!groupIds.size) return nodes;
  return nodes.map((node) => {
    if (!node.groupId || !groupIds.has(node.groupId)) return node;
    const { groupId: _groupId, ...ungrouped } = node;
    return ungrouped;
  });
}

export function duplicateObjects(nodes: DesignNode[], selected: string[], createId = () => crypto.randomUUID()): { nodes: DesignNode[]; selected: string[] } {
  const selectedIds = new Set(selected);
  const groupedIds = new Map<string, string>();
  const copies = nodes.filter((node) => selectedIds.has(node.id)).map((node) => {
    const id = createId();
    const groupId = node.groupId ? (groupedIds.get(node.groupId) ?? createId()) : undefined;
    if (node.groupId && groupId) groupedIds.set(node.groupId, groupId);
    return { ...node, id, name: `${node.name} copy`, x: node.x + 20, y: node.y + 20, ...(node.crop ? { crop: { ...node.crop } } : {}), ...(groupId ? { groupId } : {}) };
  });
  return { nodes: [...nodes, ...copies], selected: copies.map((node) => node.id) };
}

export function toggleObjectsLocked(nodes: DesignNode[], selected: string[]): DesignNode[] {
  if (!selected.length) return nodes;
  const selectedIds = new Set(selected);
  const shouldLock = !nodes.filter((node) => selectedIds.has(node.id)).every((node) => node.locked);
  return nodes.map((node) => selectedIds.has(node.id) ? { ...node, locked: shouldLock } : node);
}

export function reorderObjects(nodes: DesignNode[], selected: string[], direction: LayerDirection): DesignNode[] {
  if (!selected.length) return nodes;
  const selectedIds = new Set(selected);
  const reordered = [...nodes];
  if (direction === 'up') {
    for (let index = reordered.length - 2; index >= 0; index -= 1) {
      if (selectedIds.has(reordered[index].id) && !selectedIds.has(reordered[index + 1].id)) {
        [reordered[index], reordered[index + 1]] = [reordered[index + 1], reordered[index]];
      }
    }
  } else {
    for (let index = 1; index < reordered.length; index += 1) {
      if (selectedIds.has(reordered[index].id) && !selectedIds.has(reordered[index - 1].id)) {
        [reordered[index], reordered[index - 1]] = [reordered[index - 1], reordered[index]];
      }
    }
  }
  return reordered;
}
