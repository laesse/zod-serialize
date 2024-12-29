import z, { type ZodUnionOptions } from "zod";
import { rapidhash } from "rapidhash-js";
import { concatArrayBuffers } from "./concatArrayBuffers";

// 3 bits
enum Types {
  Nummeric, // 0b000
  String, // 0b001
  Object, // 0b010
  Date, // 0b011
  Array, // 0b100
  Union, // 0b101
  Map, // 0b110
}

enum NumberType {
  i8 = 0x0,
  f64 = 0x1,
  i16 = 0x2,
  i32 = 0x3,
  i64bigInt = 0x4,
  i64 = 0x5,
  NaN = 0x6,
  Infinity = 0x7,
  NegativeInfinity = 0x8,
  BooleanTrue = 0x9,
  BooleanFalse = 0xa,
}

const getNumberType = (value: number | bigint | boolean): NumberType => {
  if (typeof value === "boolean") {
    return value ? NumberType.BooleanTrue : NumberType.BooleanFalse;
  }
  if (typeof value === "bigint") {
    if (value >= 2n ** 63n - 1n) {
      throw new Error(
        "value: " + value + " is to big for serialization (bigger than 2^63-1)",
      );
    }
    if (value < -(2n ** 63n)) {
      throw new Error(
        "value: " +
          value +
          " is to small for serialization (smaller than -2^63)",
      );
    }
    return NumberType.i64bigInt;
  }
  if (Number.isNaN(value)) {
    return NumberType.NaN;
  }
  if (value === Infinity) {
    return NumberType.Infinity;
  }
  if (value === -Infinity) {
    return NumberType.NegativeInfinity;
  }
  if (Number.isInteger(value)) {
    if (value >= -128 && value <= 127) {
      return NumberType.i8;
    }
    if (value >= -32768 && value <= 32767) {
      return NumberType.i16;
    }
    if (value >= -2147483648 && value <= 2147483647) {
      return NumberType.i32;
    }
    if (value > Number.MAX_SAFE_INTEGER || value < Number.MIN_SAFE_INTEGER) {
      console.warn(
        "number: " +
          value +
          " is not a safe integer consider using bigInts we will serialize it but without waranty",
      );
    }
    return NumberType.i64;
  } else {
    return NumberType.f64;
  }
};

/**
*  serialize a nummeric value
*  this includes booleans
* - header byte:
      - 3 bits type tag
      - 1 bit padding
      - 4 bits Number type tag
  - content byte(s):
      - NaN | Infinity | -Infinity => 0 bytes only header
      - jBooleanTrue | BooleanFalse => 0 bytes only header
      - i8 => 1 byte
      - i16 => 2 bytes
      - i32 => 4 bytes
      - i64bigInt => 8 bytes numbers will be converted to bigint
      - i64 => 8 bytes
      - f64 => 8 bytes
* @param value nummeric value
* @returns ArrayBuffer with the serialized value
*/
const serializeNumeric = (value: number | bigint | boolean): ArrayBuffer => {
  const type = getNumberType(value);
  let buffer;
  if (type === NumberType.i8) {
    buffer = new Int8Array([value as number]);
  } else if (type === NumberType.i16) {
    buffer = new Int16Array([value as number]);
  } else if (type === NumberType.i32) {
    buffer = new Int32Array([value as number]);
  } else if (type === NumberType.i64 || type === NumberType.i64bigInt) {
    buffer = new BigInt64Array([BigInt(value as number)]);
  } else if (type === NumberType.f64) {
    buffer = new Float64Array([value as number]);
  } else if (
    type === NumberType.NaN ||
    type === NumberType.Infinity ||
    type === NumberType.NegativeInfinity ||
    type === NumberType.BooleanTrue ||
    type === NumberType.BooleanFalse
  ) {
    return new Uint8Array([(Types.Nummeric << 5) | type]).buffer;
  } else {
    throw new Error("unknown number type", type);
  }
  return concatArrayBuffers([
    new Uint8Array([(Types.Nummeric << 5) | type]),
    buffer,
  ]);
};

/**
* header: 2-3 bytes
   - 3 bits type tag
   - 1 bit length type tag
       - 0 => 12 bits length (len < 4096 bytes),
       - 1 => 20 bits length (len < 1_048_576 bytes)
       - _ => bigger strings are not supported (why should we support > 1 MB strings?)
    - length: (12 bits | 20 bits)
       body:
    text as utf-8
* @param value string to be serialized
  @returns ArrayBuffer with the serialized value
*/
const serializeString = (value: string): ArrayBuffer => {
  const textBuffer = new TextEncoder().encode(value);
  const length = textBuffer.byteLength;
  if (length >= 2 ** 20) {
    throw new Error("string to long");
  }
  const short = length < 2 ** 12;
  const header = Uint8Array.from({ length: short ? 2 : 3 });
  const view = new DataView(header.buffer);

  if (short) {
    view.setUint16(0, length & 0xfff);
  } else {
    view.setUint16(0, (length & 0x0f_ff00) >> 8);
    view.setUint8(2, length & 0xff);
  }
  header[0] |= Types.String << 5;
  header[0] |= !short ? 0x10 : 0;
  return concatArrayBuffers([header, textBuffer]);
};

/**
* serialize a date
* - header: 1 byte
    - 3 bits type tag
    - 5 bits padding
  - body:
    - 8 bytes timestamp of the date in millis
* @param value date to serialize
* @returns ArrayBuffer with the serialized value
*/
const serializeDate = (value: Date): ArrayBuffer => {
  return concatArrayBuffers([
    new Uint8Array([Types.Date << 5]),
    new BigInt64Array([BigInt(value.getTime())]),
  ]);
};

enum ObjectTypes {
  Object = 0b00,
  Null = 0b01,
  Undefined = 0b10,
  UndefinedOptional = 0b11,
}

/**
* serialize an object
  header: 1 byte
    3 bits type tag
    1 padding
    2 bits type
     - 0 => object
     - 1 => null
     - 2 => undefined (the value)
     - 3 => undefined (optional field not present)
    2 bits padding
    body:
    each field serialized in order

    note:
    optional fields that are not present will also be not present after parsing
    if they have the value undefined in them they will be present with the value undefined
  ```ts
    const schema = z.object({
       foo: z.string().optional(),
    });
    parse(schema, serialize(schema, {})); // => {} 
    parse(schema, serialize(schema, { foo: undefined })); // => { foo: undefined } 
  ```

* @param value object to serialize
* @param schema zod schema of the object
* @returns ArrayBuffer with the serialized value
*/
const serializeObject = (
  value: Record<string, unknown>,
  schema: z.AnyZodObject,
  ctx: SerializeContext,
): ArrayBuffer => {
  if (schema._def.unknownKeys === "passthrough") {
    throw new Error(
      "unknown keys can not be serialized. Passthrough not supported",
    );
  }

  const buffers = Object.entries(schema.shape as z.ZodRawShape).map(
    ([key, fieldSchema]) => {
      if (fieldSchema.isOptional() && !(key in value)) {
        return new Uint8Array([
          (Types.Object << 5) | (ObjectTypes.UndefinedOptional << 2),
        ]).buffer;
      }
      const valueField = value[key];
      return serializeInternal(fieldSchema, valueField, ctx);
    },
  );
  const header = new Uint8Array([Types.Object << 5]);
  return concatArrayBuffers([header, ...buffers]);
};

const serializeUndefined = (): ArrayBuffer =>
  new Uint8Array([(Types.Object << 5) | (ObjectTypes.Undefined << 2)]).buffer;
const serializeNull = (): ArrayBuffer =>
  new Uint8Array([(Types.Object << 5) | (ObjectTypes.Null << 2)]).buffer;

/**
 * array serialization
 * - header: 2 bytes | 4 bytes
 *   - 3 bits type tag
 *   - 2 bit length type tag
 *      - 00 => 3 bits length (len < 8 elements)
 *      - 01 => 11 bits length (len < 2048 elements)
 *      - 10 => 19 bits length (len < 524_288 elements)
 *      - 11 => free (maybe a 27 bits length (len < 134_217_728 elements))
 *   - lenght => (3 bits | 11 bits | 19 bits)
 * - body:
 *   -  each element serialized in order
 *   note:
       longer variant could be max 27 Bits length so 1/8 bilion elements it was to slow for the tests so we limited it to 524_288 elements.
 * @param value the array to serialize
 * @param schema the zod schema of the array
 * @returns ArrayBuffer with the serialized value
 */
const serializeArray = (
  value: Array<unknown> | Set<unknown>,
  schema: z.ZodArray<z.ZodTypeAny> | z.ZodSet<z.ZodTypeAny> | z.ZodTuple,
  ctx: SerializeContext,
): ArrayBuffer => {
  const arrLen = value instanceof Set ? value.size : value.length;
  const type = Types.Array;
  const header = serializeArrayHeader(arrLen);

  if (schema instanceof z.ZodSet && value instanceof Set) {
    const buffers = value
      .values()
      .map((v) => serializeInternal(schema._def.valueType, v, ctx));
    return concatArrayBuffers([header, ...buffers]);
  }
  if (value instanceof Set) {
    throw new Error(
      "set schema was given but no set to parse or set was given and no set schema",
    );
  }
  if (schema instanceof z.ZodArray) {
    const buffers = value.map((v) => serializeInternal(schema.element, v, ctx));
    return concatArrayBuffers([header, ...buffers]);
  } else if (schema instanceof z.ZodTuple) {
    const buffers = schema.items.map((schema, index) =>
      serializeInternal(schema, value[index], ctx),
    );
    return concatArrayBuffers([header, ...buffers]);
  }

  throw new Error("unreachable");
};

const serializeArrayHeader = (length: number): ArrayBuffer => {
  if (length >= 2 ** 19) {
    throw new Error(`array cannot contain more than 524_288 elements`);
  }
  const lengthType = length < 8 ? 0 : length < 2048 ? 1 : 2;
  const header = Uint8Array.from({
    length: lengthType + 1,
  });
  const view = new DataView(header.buffer);
  if (lengthType === 0) {
    view.setUint8(0, length & 0x07);
  } else if (lengthType === 1) {
    view.setUint16(0, length & 0x07ff);
  } else {
    view.setUint16(0, (length & (0x07ff << 8)) >> 8);
    view.setUint8(2, length & 0xff);
  }
  header[0] |= Types.Array << 5;
  header[0] |= lengthType << 3;
  return header.buffer;
};

/**
*  serialize a union
  - header: 1 byte
      - 3 bits type tag
      - 5 bits what type is in the union as an index of element in schema
  - body:
      - serialized elements in order
* @param input the union to serialize
* @param schema the union schema
*/
const serializeUnion = (
  input: unknown,
  schema: z.ZodUnion<ZodUnionOptions> | z.ZodDiscriminatedUnion<string, any>,
  ctx: SerializeContext,
): ArrayBuffer => {
  if (schema.options.length > 32) {
    throw new Error("unions with more than 32 options are not supported");
  }
  let buffer: ArrayBuffer | undefined;
  let index = 0;
  for (const option of schema.options) {
    if (option.safeParse(input).success) {
      buffer = serializeInternal(option, input, ctx);
      break;
    }
    index++;
  }
  if (!buffer) {
    throw new Error("invalid union");
  }
  const header = new Uint8Array([(Types.Union << 5) | index]);
  return concatArrayBuffers([header, buffer]);
};

const serializeMapHeader = (
  mapType: "map" | "object",
  length: number,
): ArrayBuffer => {
  if (length >= 2 ** 18) {
    throw new Error(`array cannot contain more than 524_288 elements`);
  }
  const lengthType = length < 1024 ? 0 : 1;
  const mapTypeTag = mapType === "map" ? 1 : 0;
  const header = Uint8Array.from({
    length: lengthType === 0 ? 2 : 3,
  });
  const view = new DataView(header.buffer);
  if (lengthType === 0) {
    view.setUint16(0, length & 0x07ff);
  } else if (lengthType === 1) {
    view.setUint16(0, (length & (0x07ff << 8)) >> 8);
    view.setUint8(2, length & 0xff);
  }
  header[0] |= Types.Map << 5;
  header[0] |= mapTypeTag << 4;
  header[0] |= lengthType << 3;
  return header.buffer;
};
/**
* serialize a map
  - header: (2|3) bytes
    - 3 bits type tag
    - 1 bit type indicator (0 => object, 1 => map)
    - 1 bit length type tag
      - 0 => 10 bits length (len < 1024 elements)
      - 1 => 18 bits length (len < 262_144 elements)
    - length: (10 bits | 18 bits)
  - body:
    key value pairs serialized in order
*/
const serializeMap = (
  value: Record<string | number | symbol, unknown> | Map<unknown, unknown>,
  schema: z.ZodMap | z.ZodRecord,
  ctx: SerializeContext,
): ArrayBuffer => {
  const length = value instanceof Map ? value.size : Object.keys(value).length;
  const header = serializeMapHeader(
    value instanceof Map ? "map" : "object",
    length,
  );
  const entries =
    value instanceof Map ? value.entries() : Object.entries(value);
  const buffers = entries.map(([key, value]) => [
    serializeInternal(schema.keySchema, key, ctx),
    serializeInternal(schema.valueSchema, value, ctx),
  ]);
  return concatArrayBuffers([header, ...buffers].flat());
};

/**
 * an intersection is a special case since it is only a type system concept
 * if we have we have an intersection type of two objects we merge the schemas and serialize the object
 * for other types we do not pick apart the intersection schema we just serialize the value according to the runtime type
 */
const serializeIntersection = (
  value: NonNullable<unknown>,
  schema: z.ZodIntersection<z.ZodTypeAny, z.ZodTypeAny>,
  ctx: SerializeContext,
): ArrayBuffer => {
  if (
    typeof value === "number" ||
    typeof value === "bigint" ||
    typeof value === "boolean"
  ) {
    return serializeNumeric(value);
  } else if (typeof value === "string") {
    return serializeString(value);
  } else if (
    typeof value === "object" &&
    schema._def.right instanceof z.ZodObject &&
    schema._def.left instanceof z.ZodObject
  ) {
    return serializeObject(
      value as Record<string, unknown>,
      schema._def.left.merge(schema._def.right),
      ctx,
    );
  }
  throw new Error("unsuported instersection schema: " + JSON.stringify(schema));
};
/**
 * there are 3 kinds of effects
 * - refinement: this is simply checking the value this has no impact on serialization
 * - preprocess: this is a transformation of the value into a given schema this has to be done before serialization
      we do this tranformation here and go on with serializing the inner value
      - ⚠️but attention the preprocess function runs twice once before serialization and once after parsing this means you need to write your preprocess function idepotent or else it will fail during parsing
 * - transform: this is transforming the value without knowing the output schema e.g. `z.string().transform((str)=> str.length)`
 *     this is no problem if we do the tranformation of the value after parsing the value back from its serialized form since we have a schema for the value before serialization
 *     it becomes a problem if we have to do the transformation during serialization because we can't serialize values that have an unkown schema.
 *     so far this is only the case if there is a .catch() "suronding" the .transform() and the catch is triggered
 * @param value the value to serialize
 * @param schema zod effects schema
 * @param ctx serialization context
 * @returns the serialized array buffer
 */
const serializeEffects = (
  value: unknown,
  schema: z.ZodEffects<z.ZodTypeAny>,
  ctx: SerializeContext,
): ArrayBuffer => {
  if (schema._def.effect.type === "preprocess") {
    const processed = schema._def.effect.transform(value, {
      addIssue: () => {},
      path: [],
    });
    return serializeInternal(schema.innerType(), processed, ctx);
  }
  if (ctx.parsed && schema._def.effect.type === "transform") {
    throw new Error(
      "cannot serialize transformed value. value was transformed because it is nested inside an .catch() and the catch was triggered",
    );
  }
  return serializeInternal(schema.innerType(), value, ctx);
};

export const serialize = <T>(
  schema: z.ZodType<T>,
  input: T | unknown,
): ArrayBuffer => {
  const parseRes = schema.safeParse(input);
  if (!parseRes.success) {
    throw new Error("cannot parse schema", { cause: parseRes.error });
  }
  const headerBuffer = makeHeader(schema);
  const contentBuffer = serializeInternal(schema, input, { parsed: false });
  return concatArrayBuffers([headerBuffer, contentBuffer]);
};

type SerializeContext = { parsed: boolean };

const serializeInternal = <T>(
  schema: z.ZodType<T>,
  input: T,
  ctx: SerializeContext,
): ArrayBuffer => {
  switch (true) {
    case schema instanceof z.ZodAny:
      throw new Error("z.any() schema cannot be serialized");
    case schema instanceof z.ZodUnknown:
      throw new Error("z.unknown() schema cannot be serialized");
    case schema instanceof z.ZodNever:
      throw new Error("z.never() schema cannot be serialized");
    case schema instanceof z.ZodVoid:
      throw new Error("z.void() schema cannot be serialized");
    case schema instanceof z.ZodFunction:
      throw new Error("z.function() schema cannot be serialized");
    case schema instanceof z.ZodSymbol:
      throw new Error("z.symbol() schema cannot be serialized");
    case schema instanceof z.ZodPromise:
      throw new Error(
        "z.promise() schema cannot be serialized await Promise first",
      );
    case schema.isNullable() && input === null:
      return serializeNull();
    case schema.isOptional() && input === undefined:
      return serializeUndefined();
    case input === undefined || input === null:
      throw new Error(
        "undefined or null value with non nullish schema cannot be serialized",
      );
    case schema instanceof z.ZodNativeEnum && typeof input === "string":
    case schema instanceof z.ZodLiteral && typeof input === "string":
    case schema instanceof z.ZodString:
    case schema instanceof z.ZodEnum:
      return serializeString(input as string);
    case schema instanceof z.ZodNativeEnum && typeof input === "number":
    case schema instanceof z.ZodLiteral && typeof input === "number":
    case schema instanceof z.ZodLiteral && typeof input === "bigint":
    case schema instanceof z.ZodBigInt && !schema._def.coerce:
    case schema instanceof z.ZodNumber:
    case schema instanceof z.ZodNaN:
      return serializeNumeric(input as number);
    case schema instanceof z.ZodBigInt:
      return serializeNumeric(BigInt(input as number));
    case schema instanceof z.ZodLiteral && typeof input === "boolean":
    case schema instanceof z.ZodBoolean:
      return serializeNumeric(input as boolean);
    case schema instanceof z.ZodObject:
      return serializeObject(input as Record<string, unknown>, schema, ctx);
    case schema instanceof z.ZodDate && schema._def.coerce:
      return serializeDate(new Date(input as unknown as string));
    case schema instanceof z.ZodDate:
      return serializeDate(input as unknown as Date);
    case schema instanceof z.ZodArray:
    case schema instanceof z.ZodTuple:
      return serializeArray(input as Array<unknown>, schema, ctx);
    case schema instanceof z.ZodSet:
      return serializeArray(input as unknown as Set<unknown>, schema, ctx);
    case schema instanceof z.ZodUnion:
    case schema instanceof z.ZodDiscriminatedUnion:
      return serializeUnion(input as Array<unknown>, schema, ctx);
    case schema instanceof z.ZodRecord:
      return serializeMap(input as Record<string, unknown>, schema, ctx);
    case schema instanceof z.ZodMap:
      return serializeMap(
        input as unknown as Map<unknown, unknown>,
        schema,
        ctx,
      );
    case schema instanceof z.ZodIntersection:
      return serializeIntersection(input, schema, ctx);
    case schema instanceof z.ZodOptional:
      return serializeInternal(schema.unwrap(), input, ctx);
    case schema instanceof z.ZodNullable:
      return serializeInternal(schema.unwrap(), input, ctx);
    case schema instanceof z.ZodLazy:
      return serializeInternal(schema.schema, input, ctx);
    case schema instanceof z.ZodDefault:
      return serializeInternal(schema.removeDefault(), input, ctx);
    case schema instanceof z.ZodCatch:
      const innerParseResult = schema.removeCatch().safeParse(input);
      if (innerParseResult.success) {
        return serializeInternal(schema.removeCatch(), input, ctx);
      } else {
        return serializeInternal(
          schema.removeCatch(),
          schema._def.catchValue({ error: innerParseResult.error, input }),
          { parsed: true },
        );
      }
    case schema instanceof z.ZodReadonly:
      return serializeInternal(schema.unwrap(), input, ctx);
    case schema instanceof z.ZodBranded:
      return serializeInternal(schema.unwrap(), input, ctx);
    case schema instanceof z.ZodPipeline:
      return serializeInternal(schema._def.in, input, ctx);
    case schema instanceof z.ZodEffects:
      return serializeEffects(input, schema, ctx);
  }

  console.log(schema);

  throw new Error("unimplemented");
};

export const PROTOCOL_VERSION = 1;
const makeHeader = (schema: z.ZodTypeAny): ArrayBuffer => {
  const buffer = new ArrayBuffer(9);
  const view = new DataView(buffer);
  view.setUint8(0, PROTOCOL_VERSION);
  view.setBigUint64(
    1,
    rapidhash(new Uint8Array(zodTypeIdentity(schema, { lazySeen: [] }))),
  );
  return buffer;
};

const zodTypeIdentity = <T>(
  schema: z.ZodType<T>,
  ctx: { lazySeen: Array<z.ZodLazy<any>> },
): Types[] => {
  switch (true) {
    case schema instanceof z.ZodAny:
      throw new Error("z.any() schema cannot be serialized");
    case schema instanceof z.ZodUnknown:
      throw new Error("z.unknown() schema cannot be serialized");
    case schema instanceof z.ZodNever:
      throw new Error("z.never() schema cannot be serialized");
    case schema instanceof z.ZodVoid:
      throw new Error("z.void() schema cannot be serialized");
    case schema instanceof z.ZodFunction:
      throw new Error("z.function() schema cannot be serialized");
    case schema instanceof z.ZodSymbol:
      throw new Error("z.symbol() schema cannot be serialized");
    case schema instanceof z.ZodPromise:
      throw new Error(
        "z.promise() schema cannot be serialized await Promise first",
      );
    case schema instanceof z.ZodLiteral && schema.value === undefined:
    case schema instanceof z.ZodLiteral && schema.value === null:
    case schema instanceof z.ZodUndefined:
    case schema instanceof z.ZodNull:
      return [Types.Object];
    case schema instanceof z.ZodNativeEnum &&
      typeof schema.enum[Object.keys(schema.enum)[0]] === "string":
    case schema instanceof z.ZodLiteral && typeof schema.value === "string":
    case schema instanceof z.ZodString:
    case schema instanceof z.ZodEnum:
      return [Types.String];
    case schema instanceof z.ZodNativeEnum &&
      typeof schema.enum[Object.keys(schema.enum)[0]] === "number":
    case schema instanceof z.ZodBigInt && !schema._def.coerce:
    case schema instanceof z.ZodNumber:
    case schema instanceof z.ZodNaN:
    case schema instanceof z.ZodBigInt:
    case schema instanceof z.ZodLiteral && typeof schema.value === "number":
    case schema instanceof z.ZodLiteral && typeof schema.value === "bigint":
    case schema instanceof z.ZodLiteral && typeof schema.value === "boolean":
    case schema instanceof z.ZodBoolean:
      return [Types.Nummeric];
    case schema instanceof z.ZodDate:
      return [Types.Date];
    case schema instanceof z.ZodObject:
      return [
        Types.Object,
        ...Object.entries(schema.shape).flatMap(([_, field]) =>
          zodTypeIdentity(field as z.ZodTypeAny, ctx),
        ),
      ];
    case schema instanceof z.ZodArray:
      return [Types.Array, ...zodTypeIdentity(schema.element, ctx)];
    case schema instanceof z.ZodTuple:
      return [
        Types.Array,
        ...(schema as z.ZodTuple).items.flatMap((i) => zodTypeIdentity(i, ctx)),
      ];
    case schema instanceof z.ZodSet:
      return [Types.Array, ...zodTypeIdentity(schema._def.valueType, ctx)];
    case schema instanceof z.ZodUnion:
    case schema instanceof z.ZodDiscriminatedUnion:
      return [
        Types.Union,
        ...schema.options.flatMap((o: z.ZodTypeAny) => zodTypeIdentity(o, ctx)),
      ];
    case schema instanceof z.ZodRecord:
    case schema instanceof z.ZodMap:
      return [
        Types.Map,
        ...zodTypeIdentity(schema.keySchema, ctx),
        ...zodTypeIdentity(schema.valueSchema, ctx),
      ];
    case schema instanceof z.ZodIntersection:
      return [
        ...zodTypeIdentity(schema._def.left, ctx),
        ...zodTypeIdentity(schema._def.right, ctx),
      ];
    case schema instanceof z.ZodOptional:
    case schema instanceof z.ZodNullable:
    case schema instanceof z.ZodReadonly:
    case schema instanceof z.ZodBranded:
      return zodTypeIdentity(schema.unwrap(), ctx);
    case schema instanceof z.ZodLazy:
      if (!ctx.lazySeen.includes(schema)) {
        ctx.lazySeen.push(schema);
        return zodTypeIdentity(schema.schema, ctx);
      }
      return [];
    case schema instanceof z.ZodDefault:
      return zodTypeIdentity(schema.removeDefault(), ctx);
    case schema instanceof z.ZodCatch:
      return zodTypeIdentity(schema.removeCatch(), ctx);
    case schema instanceof z.ZodPipeline:
      return zodTypeIdentity(schema._def.in, ctx);
    case schema instanceof z.ZodEffects:
      return zodTypeIdentity(schema.innerType(), ctx);
  }

  console.log(schema);

  throw new Error("unimplemented");
};
type ParseContext = { offset: number };

const parseString = (buffer: ArrayBuffer, ctx: ParseContext): string => {
  const view = new DataView(buffer);
  let length;
  if (view.getUint8(ctx.offset) & 0b10000) {
    length =
      ((view.getUint8(ctx.offset) & 0b1111) << 16) +
      view.getUint16(ctx.offset + 1);
    ctx.offset += 3;
  } else {
    length = view.getUint16(ctx.offset) & 0x0fff;
    ctx.offset += 2;
  }
  const text = new TextDecoder().decode(
    new Uint8Array(buffer, ctx.offset, length),
  );
  ctx.offset += length;
  return text;
};

const parseNumber = (
  buffer: ArrayBuffer,
  ctx: ParseContext,
): number | bigint | boolean => {
  const view = new DataView(buffer);
  const type = view.getUint8(ctx.offset) & 0b1111;
  ctx.offset += 1; // header
  switch (type) {
    case NumberType.i8:
      ctx.offset += 1;
      return view.getInt8(ctx.offset - 1);
    case NumberType.i16:
      ctx.offset += 2;
      return view.getInt16(ctx.offset - 2, true);
    case NumberType.i32:
      ctx.offset += 4;
      return view.getInt32(ctx.offset - 4, true);
    case NumberType.i64:
      ctx.offset += 8;
      return Number(view.getBigInt64(ctx.offset - 8, true));
    case NumberType.i64bigInt:
      ctx.offset += 8;
      return view.getBigInt64(ctx.offset - 8, true);
    case NumberType.f64:
      ctx.offset += 8;
      return view.getFloat64(ctx.offset - 8, true);
    case NumberType.NaN:
      return NaN;
    case NumberType.Infinity:
      return Infinity;
    case NumberType.NegativeInfinity:
      return -Infinity;
    case NumberType.BooleanTrue:
      return true;
    case NumberType.BooleanFalse:
      return false;
  }
  throw new Error("unimplemented");
};

const parseDate = (buffer: ArrayBuffer, ctx: ParseContext): Date => {
  const view = new DataView(buffer);
  ctx.offset += 1 + 8;
  return new Date(Number(view.getBigInt64(ctx.offset - 8, true)));
};

const parseObject = (
  schema: z.AnyZodObject,
  buffer: ArrayBuffer,
  ctx: ParseContext,
): Record<string, unknown> => {
  const obj: Record<string, unknown> = {};
  ctx.offset += 1; // header
  const view = new DataView(buffer);
  for (const key in schema.shape) {
    const field = schema.shape[key];
    if (
      field.isOptional() &&
      (view.getUint8(ctx.offset) & 0b1100) ===
        ObjectTypes.UndefinedOptional << 2
    ) {
      // field is optional and was not present in the serialized object
      ctx.offset++;
      continue;
    }
    const value = parseInternal(field, buffer, ctx);
    obj[key] = value;
  }
  return obj;
};

const parseArrayHeader = (buffer: ArrayBuffer, ctx: ParseContext): number => {
  const view = new DataView(buffer);
  const header = view.getUint8(ctx.offset);
  const lengthTag = (header & 0b11000) >> 3;

  if (lengthTag == 0) {
    ctx.offset += 1;
    return header & 0x7;
  } else if (lengthTag == 1) {
    ctx.offset += 2;
    return view.getUint16(ctx.offset - 2) & 0x07ff;
  } else if (lengthTag == 2) {
    ctx.offset += 3;
    return ((header & 0x7) << 16) + view.getUint16(ctx.offset - 2);
  } else {
    throw new Error(
      "array length tag 0b11 is unused so far and shouldn't be used",
    );
  }
};

const parseArray = (
  schema: z.ZodArray<z.ZodTypeAny> | z.ZodTuple | z.ZodSet,
  buffer: ArrayBuffer,
  ctx: ParseContext,
): Array<unknown> | Set<unknown> => {
  const length = parseArrayHeader(buffer, ctx);

  if (schema instanceof z.ZodArray) {
    const array = Array.from({ length });
    for (let i = 0; i < length; i++) {
      array[i] = parseInternal(schema.element, buffer, ctx);
    }
    return array;
  } else if (schema instanceof z.ZodTuple) {
    const array = Array.from({ length });
    for (let i = 0; i < length; i++) {
      array[i] = parseInternal(schema.items[i], buffer, ctx);
    }
    return array;
  } else if (schema instanceof z.ZodSet) {
    const array = Array.from({ length });
    for (let i = 0; i < length; i++) {
      array[i] = parseInternal(schema._def.valueType, buffer, ctx);
    }
    return new Set(array);
  }
  throw new Error("unreachable");
};

const parseUnion = (
  schema: z.ZodUnion<ZodUnionOptions> | z.ZodDiscriminatedUnion<string, any>,
  buffer: ArrayBuffer,
  ctx: ParseContext,
): unknown => {
  const view = new DataView(buffer);
  const unionElementIndex = view.getUint8(ctx.offset) & 0x1f;
  ctx.offset++;
  return parseInternal(schema.options[unionElementIndex], buffer, ctx);
};

const parseMapHeader = (
  buffer: ArrayBuffer,
  ctx: ParseContext,
): { isMap: boolean; length: number } => {
  const view = new DataView(buffer);
  const header = view.getUint8(ctx.offset);
  const isMap = !!(header & 0b1_0000);
  const lengthTag = (header & 0b1000) >> 3;

  let length: number;
  if (lengthTag == 0) {
    ctx.offset += 2;
    length = view.getUint16(ctx.offset - 2) & 0x07ff;
  } else if (lengthTag == 1) {
    ctx.offset += 3;
    length = ((header & 0x7) << 16) + view.getUint16(ctx.offset - 2);
  } else {
    throw new Error(
      "array length tag 0b11 is unused so far and shouldn't be used",
    );
  }
  return { isMap, length };
};
const parseMap = (
  schema: z.ZodMap | z.ZodRecord,
  buffer: ArrayBuffer,
  ctx: ParseContext,
): Map<unknown, unknown> | Record<string, unknown> => {
  const { length, isMap } = parseMapHeader(buffer, ctx);
  const entries = Array.from({ length }).map(
    () =>
      [
        parseInternal(schema.keySchema, buffer, ctx),
        parseInternal(schema.valueSchema, buffer, ctx),
      ] as const,
  );
  return isMap ? new Map(entries) : Object.fromEntries(entries);
};

const parseHeader = (
  buffer: ArrayBuffer,
): { version: number; hash: bigint } => {
  const view = new DataView(buffer);
  const version = view.getUint8(0);
  const hash = view.getBigUint64(1);
  return { version, hash };
};

export const parse = <T>(schema: z.ZodType<T>, buffer: ArrayBuffer): T => {
  const { version, hash } = parseHeader(buffer);
  const schemaHash = rapidhash(
    new Uint8Array(zodTypeIdentity(schema, { lazySeen: [] })),
  );
  if (version !== PROTOCOL_VERSION) {
    throw new Error("Protocol versions does not match cannot decode value");
  }
  if (hash !== schemaHash) {
    throw new Error("Schemas do not match cannot decode value");
  }
  const value = parseInternal(schema, buffer, { offset: 9 });
  return schema.parse(value);
};

const parseInternal = <T>(
  schema: z.ZodType<T>,
  buffer: ArrayBuffer,
  ctx: ParseContext,
): T => {
  const view = new DataView(buffer);
  const headerByte = view.getUint8(ctx.offset);
  const typeTag = headerByte >> 5;

  switch (true) {
    case typeTag === Types.Object &&
      schema.isNullable() &&
      (headerByte & 0b1100) >> 2 === ObjectTypes.Null:
      ctx.offset++;
      return null as T;
    case typeTag === Types.Object &&
      schema.isOptional() &&
      (headerByte & 0b1100) >> 2 === ObjectTypes.Undefined:
      ctx.offset++;
      return undefined as T;
    case typeTag === Types.String && schema instanceof z.ZodNativeEnum:
    case typeTag === Types.String && schema instanceof z.ZodString:
    case typeTag === Types.String && schema instanceof z.ZodEnum:
    case typeTag === Types.String && schema instanceof z.ZodLiteral:
    case typeTag === Types.String && schema instanceof z.ZodIntersection:
      return parseString(buffer, ctx) as T;
    case typeTag === Types.Nummeric && schema instanceof z.ZodNativeEnum:
    case typeTag === Types.Nummeric && schema instanceof z.ZodNumber:
    case typeTag === Types.Nummeric && schema instanceof z.ZodBigInt:
    case typeTag === Types.Nummeric && schema instanceof z.ZodNaN:
    case typeTag === Types.Nummeric && schema instanceof z.ZodLiteral:
    case typeTag === Types.Nummeric && schema instanceof z.ZodIntersection:
    case typeTag === Types.Nummeric && schema instanceof z.ZodBoolean:
      return parseNumber(buffer, ctx) as T;
    case typeTag === Types.Date && schema instanceof z.ZodDate:
      return parseDate(buffer, ctx) as T;
    case typeTag === Types.Object && schema instanceof z.ZodObject:
      return parseObject(schema, buffer, ctx) as T;
    case typeTag === Types.Object && schema instanceof z.ZodIntersection:
      const mergedSchema = schema._def.left.merge(schema._def.right);
      return parseObject(mergedSchema, buffer, ctx) as T;
    case typeTag === Types.Array && schema instanceof z.ZodArray:
    case typeTag === Types.Array && schema instanceof z.ZodTuple:
    case typeTag === Types.Array && schema instanceof z.ZodSet:
      return parseArray(schema, buffer, ctx) as T;
    case typeTag === Types.Union && schema instanceof z.ZodUnion:
    case typeTag === Types.Union && schema instanceof z.ZodDiscriminatedUnion:
      return parseUnion(schema, buffer, ctx) as T;
    case typeTag === Types.Map && schema instanceof z.ZodRecord:
    case typeTag === Types.Map && schema instanceof z.ZodMap:
      return parseMap(schema, buffer, ctx) as T;
    case schema instanceof z.ZodOptional:
      return parseInternal(schema.unwrap(), buffer, ctx);
    case schema instanceof z.ZodNullable:
      return parseInternal(schema.unwrap(), buffer, ctx);
    case schema instanceof z.ZodLazy:
      return parseInternal(schema.schema, buffer, ctx);
    case schema instanceof z.ZodDefault:
      return parseInternal(schema.removeDefault(), buffer, ctx);
    case schema instanceof z.ZodCatch:
      return parseInternal(schema.removeCatch(), buffer, ctx);
    case schema instanceof z.ZodReadonly:
      return parseInternal(schema.unwrap(), buffer, ctx);
    case schema instanceof z.ZodBranded:
      return parseInternal(schema.unwrap(), buffer, ctx);
    case schema instanceof z.ZodPipeline:
      return parseInternal(schema._def.in, buffer, ctx);
    case schema instanceof z.ZodEffects:
      return parseInternal(schema._def.schema, buffer, ctx);
  }

  console.log(ctx, typeTag, schema);
  throw new Error("unimplemented");
};
