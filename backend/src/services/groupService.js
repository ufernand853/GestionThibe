const { Types } = require('mongoose');
const Group = require('../models/Group');

async function collectGroupAndDescendantIds(groupId) {
  const normalized = typeof groupId === 'string' ? groupId.trim() : '';
  if (!normalized || !Types.ObjectId.isValid(normalized)) {
    return [];
  }

  const groups = await Group.find()
    .select({ _id: 1, parent: 1 })
    .lean();

  const targetId = normalized;
  const hasTarget = groups.some(group => String(group._id) === targetId);
  if (!hasTarget) {
    return [];
  }

  const childrenMap = new Map();
  groups.forEach(group => {
    const parentId = group.parent ? String(group.parent) : null;
    if (!childrenMap.has(parentId)) {
      childrenMap.set(parentId, []);
    }
    childrenMap.get(parentId).push(String(group._id));
  });

  const queue = [targetId];
  const visited = new Set();
  const result = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (visited.has(current)) {
      continue;
    }
    visited.add(current);
    result.push(current);
    const children = childrenMap.get(current);
    if (Array.isArray(children) && children.length > 0) {
      children.forEach(childId => {
        if (!visited.has(childId)) {
          queue.push(childId);
        }
      });
    }
  }

  return result;
}

module.exports = {
  collectGroupAndDescendantIds
};
