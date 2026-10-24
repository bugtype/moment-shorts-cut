export class CommandError extends Error {
  constructor(code, message, path) { super(message); this.name='CommandError'; this.code=code; if(path)this.path=path; }
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
export function validate(schema,value,path='arguments') {
  if(Array.isArray(schema.type)){
    if(value===null&&schema.type.includes('null'))return;
    return validate({...schema,type:schema.type.find(type=>type!=='null')},value,path);
  }
  if(schema.enum&&!schema.enum.includes(value))fail('허용되지 않은 값입니다.',path);
  if(schema.type==='object'){
    if(!value||typeof value!=='object'||Array.isArray(value))fail('객체가 필요합니다.',path);
    for(const key of Object.keys(value))if(!Object.hasOwn(schema.properties||{},key)&&schema.additionalProperties===false)fail('지원하지 않는 필드입니다.',`${path}.${key}`);
    for(const key of schema.required||[])if(!Object.hasOwn(value,key))fail('필수 값이 없습니다.',`${path}.${key}`);
    for(const [key,child] of Object.entries(schema.properties||{}))if(Object.hasOwn(value,key))validate(child,value[key],`${path}.${key}`);
  }else if(schema.type==='array'){
    if(!Array.isArray(value)||value.length<schema.minItems||value.length>schema.maxItems)fail('배열 길이를 확인하세요.',path);
    value.forEach((item,i)=>validate(schema.items,item,`${path}[${i}]`));
  }else if(schema.type==='number'){
    if(!Number.isFinite(value)||value<schema.minimum||value>schema.maximum)fail('숫자 범위를 확인하세요.',path);
  }else if(schema.type==='string'){
    if(typeof value!=='string'||value.length>schema.maxLength)fail('문자열 길이를 확인하세요.',path);
  }else if(schema.type==='boolean'&&typeof value!=='boolean')fail('참/거짓 값이 필요합니다.',path);
}

export function assertJson(value) {
  let count=0;
  const visit=(v,path,depth)=>{
    if(++count>100000||depth>30)fail('데이터가 너무 크거나 깊습니다.',path);
    if(v===null||typeof v==='boolean')return;
    if(typeof v==='number'){if(!Number.isFinite(v))fail('유한한 숫자가 필요합니다.',path);return;}
    if(typeof v==='string'){if(v.length>100000)fail('문자열이 너무 깁니다.',path);return;}
    if(!v||typeof v!=='object'||(!Array.isArray(v)&&Object.prototype.toString.call(v)!=='[object Object]'))fail('JSON 데이터만 사용할 수 있습니다.',path);
    if(Array.isArray(v)){
      if(v.length>100000-count)fail('데이터가 너무 크거나 깊습니다.',path);
      // Holes and hidden indices do not survive both cloning and JSON round-trips.
      for(let i=0;i<v.length;i++)if(!Object.prototype.propertyIsEnumerable.call(v,i))fail('배열의 빈 항목이나 숨겨진 항목은 사용할 수 없습니다.',`${path}[${i}]`);
    }
    for(const [key,child] of Object.entries(v)){
      if(['__proto__','constructor','prototype'].includes(key))fail('허용되지 않은 필드 이름입니다.',path);
      visit(child,`${path}.${key}`,depth+1);
    }
  };
  visit(value,'$',0);
}
