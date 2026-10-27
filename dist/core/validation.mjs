import { message as msg } from '../i18n.mjs';
export class CommandError extends Error {
  constructor(code, value, path) {
    super(value?.messageKey ? value.message : value);
    this.name = 'CommandError';
    this.code = code;
    if (path)
      this.path = path;
    if (value?.messageKey) {
      this.messageKey = value.messageKey;
      this.messageParams = value.messageParams;
    }
  }
}
// Message metadata is internal; serialized API error shapes remain unchanged.
export class LocalizedError extends Error {
  constructor(value) {
    super(value?.messageKey ? value.message : value);
    if (value?.messageKey) {
      this.messageKey = value.messageKey;
      this.messageParams = value.messageParams;
    }
  }
}
export const fail=(message,path)=>{throw new CommandError('INVALID_ARGUMENT',message,path);};
export const object=(properties={},required=[])=>({type:'object',properties,required,additionalProperties:false});
export const string=(maxLength=200)=>({type:'string',maxLength});
export const number=(minimum,maximum)=>({type:'number',minimum,maximum});
export const choice=(...values)=>({enum:values});
export const boolean={type:'boolean'};

// Source-time bounds can differ by a few ulps even for exact decimal tenths.
// Tolerate only floating-point roundoff; never round or rewrite authored times.
export function hasMinimumDuration(start,end,minimum=.1){
  if(![start,end,minimum].every(Number.isFinite)||minimum<=0||end<=start)return false;
  const tolerance=Number.EPSILON*Math.max(1,Math.abs(start),Math.abs(end))*4;
  return end-start+tolerance>=minimum;
}

export const array=(items,maxItems=10000,minItems=0)=>({type:'array',items,maxItems,minItems});

// Deliberately implements only the JSON Schema subset used by our own descriptors.
// The exported schemas remain usable by a full validator in a future server.
export function validate(schema, value, path = 'arguments') {
  if (Array.isArray(schema.type)) {
    if (value === null && schema.type.includes('null'))
      return;
    return validate({ ...schema, type: schema.type.find(type => type !== 'null') }, value, path);
  }
  if (schema.enum && !schema.enum.includes(value))
    fail(msg('errors.value'), path);
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      fail(msg('errors.object'), path);
    for (const key of Object.keys(value))
      if (!Object.hasOwn(schema.properties || {}, key) && schema.additionalProperties === false)
        fail(msg('errors.field'), `${path}.${key}`);
    for (const key of schema.required || [])
      if (!Object.hasOwn(value, key))
        fail(msg('errors.required'), `${path}.${key}`);
    for (const [key, child] of Object.entries(schema.properties || {}))
      if (Object.hasOwn(value, key))
        validate(child, value[key], `${path}.${key}`);
  } else if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length < schema.minItems || value.length > schema.maxItems)
      fail(msg('errors.arrayLength'), path);
    value.forEach((item, i) => validate(schema.items, item, `${path}[${i}]`));
  } else if (schema.type === 'number') {
    if (!Number.isFinite(value) || value < schema.minimum || value > schema.maximum)
      fail(msg('errors.numberRange'), path);
  } else if (schema.type === 'string') {
    if (typeof value !== 'string' || value.length > schema.maxLength)
      fail(msg('errors.stringLength'), path);
  } else if (schema.type === 'boolean' && typeof value !== 'boolean')
    fail(msg('errors.boolean'), path);
}

export function assertJson(value) {
  let count = 0;
  const visit = (v, path, depth) => {
    if (++count > 100000 || depth > 30)
      fail(msg('errors.dataBudget'), path);
    if (v === null || typeof v === 'boolean')
      return;
    if (typeof v === 'number') {
      if (!Number.isFinite(v))
        fail(msg('errors.finiteNumber'), path);
      return;
    }
    if (typeof v === 'string') {
      if (v.length > 100000)
        fail(msg('errors.longString'), path);
      return;
    }
    if (!v || typeof v !== 'object' || (!Array.isArray(v) && Object.prototype.toString.call(v) !== '[object Object]'))
      fail(msg('errors.jsonOnly'), path);
    if (Array.isArray(v)) {
      if (v.length > 100000 - count)
        fail(msg('errors.dataBudget'), path);
      // Holes and hidden indices do not survive both cloning and JSON round-trips.
      for (let i = 0; i < v.length; i++)
        if (!Object.prototype.propertyIsEnumerable.call(v, i))
          fail(msg('errors.arrayHoles'), `${path}[${i}]`);
    }
    for (const [key, child] of Object.entries(v)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key))
        fail(msg('errors.fieldName'), path);
      visit(child, `${path}.${key}`, depth + 1);
    }
  };
  visit(value, '$', 0);
}
