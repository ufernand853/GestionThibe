const { Schema, model, Types } = require('mongoose');

const movementLogSchema = new Schema(
  {
    movementRequest: { type: Types.ObjectId, ref: 'MovementRequest', required: true },
    action: { type: String, required: true },
    actor: { type: Types.ObjectId, ref: 'User', required: true },
    timestamp: { type: Date, default: Date.now },
    metadata: { type: Map, of: String, default: {} }
  },
  {
    timestamps: false,
    versionKey: false
  }
);

movementLogSchema.index({ movementRequest: 1, timestamp: -1 });

module.exports = model('MovementLog', movementLogSchema);
