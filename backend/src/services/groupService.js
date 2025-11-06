const { Types } = require('mongoose');
const Group = require('../models/Group');

function toObjectId(value) {
  if (value instanceof Types.ObjectId) {
    return value;
  }
  return new Types.ObjectId(value);
}

async function collectGroupAndDescendantIds(groupId) {
  const normalized = typeof groupId === 'string' ? groupId.trim() : '';
  if (!normalized || !Types.ObjectId.isValid(normalized)) {
    return [];
  }

  const rootId = new Types.ObjectId(normalized);
  const [result] = await Group.aggregate([
    { $match: { _id: rootId } },
    {
      $graphLookup: {
        from: Group.collection.name,
        startWith: '$_id',
        connectFromField: '_id',
        connectToField: 'parent',
        as: 'descendants'
      }
    },
    {
      $project: {
        ids: {
          $setUnion: [
            ['$_id'],
            {
              $map: {
                input: '$descendants',
                as: 'descendant',
                in: '$$descendant._id'
              }
            }
          ]
        }
      }
    }
  ]);

  if (!result || !Array.isArray(result.ids)) {
    return [];
  }

  const uniqueIds = [];
  const seen = new Set();
  result.ids.forEach(id => {
    const stringId = String(id);
    if (!seen.has(stringId) && Types.ObjectId.isValid(stringId)) {
      seen.add(stringId);
      uniqueIds.push(toObjectId(stringId));
    }
  });

  return uniqueIds;
}

function buildGroupFilterValues(groupIds) {
  if (!Array.isArray(groupIds) || groupIds.length === 0) {
    return [];
  }

  const values = [];
  const seen = new Set();

  groupIds.forEach(id => {
    try {
      const objectId = toObjectId(id);
      const stringId = String(objectId);
      if (seen.has(stringId)) {
        return;
      }
      seen.add(stringId);
      values.push(objectId);
      values.push(stringId);
    } catch (error) {
      // Ignore invalid identifiers to avoid throwing during query building.
    }
  });

  return values;
}

module.exports = {
  collectGroupAndDescendantIds,
  buildGroupFilterValues
};
