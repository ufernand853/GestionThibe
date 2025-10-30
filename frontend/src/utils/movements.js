export const MOVEMENT_TYPE_LABELS = Object.freeze({
  transfer: 'Transferencia',
  ingress: 'Entrada',
  egress: 'Salida'
});

export const MOVEMENT_TYPE_BADGE_CLASS = Object.freeze({
  transfer: 'movement-transfer',
  ingress: 'movement-ingress',
  egress: 'movement-egress'
});

export function resolveMovementType({ explicitType, fromType, toType }) {
  if (explicitType && ['ingress', 'egress'].includes(explicitType)) {
    return explicitType;
  }
  if (fromType === 'externalOrigin') {
    return 'ingress';
  }
  if (toType === 'external') {
    return 'egress';
  }
  if (explicitType && MOVEMENT_TYPE_LABELS[explicitType]) {
    return explicitType;
  }
  return 'transfer';
}

export function locationTypeSuffix(type) {
  if (type === 'external') {
    return ' · Destino externo';
  }
  if (type === 'externalOrigin') {
    return ' · Origen externo';
  }
  return '';
}
