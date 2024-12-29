import { describe, it, test, expect } from "bun:test";
import z from "zod";
import { serialize, parse } from ".";

const serializeAndParse = <T>(schema: z.ZodType<T, any>, value: T | unknown) =>
  parse(schema, serialize(schema, value));

describe("e2e", () => {
  describe("string", () => {
    it("serializes and parses a string", () => {
      expect(serializeAndParse(z.string(), "hello")).toBe("hello");
    });
    it("coerces the value to a string", () => {
      expect(serializeAndParse(z.coerce.string(), 33)).toBe("33");
    });
    it("doesn't coerce the value if it shouldn't ", () => {
      expect(() => serializeAndParse(z.string(), 33)).toThrow();
    });
    it("serializes and parses a long string", () => {
      expect(serializeAndParse(z.string(), "hello".repeat(2000))).toBe(
        "hello".repeat(2000),
      );
    });
    it("failes if the string is to long", () => {
      expect(() =>
        serializeAndParse(z.string(), "x".repeat(2 ** 20)),
      ).toThrow();
    });
  });
  describe("numeric", () => {
    describe("variants", () => {
      it("serializes and parses a 8bit number", () => {
        expect(serializeAndParse(z.number(), 42)).toBe(42);
      });
      it("serializes and parses a 16 bit number", () => {
        expect(serializeAndParse(z.number(), 2 ** 10)).toBe(2 ** 10);
      });
      it("serializes and parses a 32 bit number", () => {
        expect(serializeAndParse(z.number(), 2 ** 24)).toBe(2 ** 24);
      });
      it("serializes and parses a 64 bit number", () => {
        expect(serializeAndParse(z.number(), 2 ** 35)).toBe(2 ** 35);
      });
      it("serializes and parses a 64 bit bigint", () => {
        expect(serializeAndParse(z.bigint(), 2n ** 35n)).toBe(2n ** 35n);
      });
      it("serializes and parses floats", () => {
        expect(serializeAndParse(z.number(), 3.141)).toBe(3.141);
      });
      it("serializes and parses Infinity", () => {
        expect(serializeAndParse(z.number(), Infinity)).toBe(Infinity);
      });
      it("serializes and parses -Infinity", () => {
        expect(serializeAndParse(z.number(), -Infinity)).toBe(-Infinity);
      });
      it("serializes and parses NaN", () => {
        expect(serializeAndParse(z.nan(), NaN)).toBe(NaN);
      });
      it("serializes and parses negative numbers", () => {
        expect(serializeAndParse(z.number(), -33)).toBe(-33);
      });
    });
    describe("limits", () => {
      it("failes for to big bigints", () => {
        expect(() => serializeAndParse(z.bigint(), 2n ** 63n)).toThrow();
      });
      it("failes for to small bigints", () => {
        expect(() =>
          serializeAndParse(z.bigint(), -(2n ** 63n) - 1n),
        ).toThrow();
      });
    });
    describe("coercion", () => {
      it("coerces numeric strings to numbers", () => {
        expect(serializeAndParse(z.coerce.number(), "22")).toBe(22);
      });
      it("doesn't coerce the value if it shouldn't", () => {
        expect(() => serializeAndParse(z.number(), "22")).toThrow();
      });
      it("coerces numeric strings to bigints", () => {
        expect(serializeAndParse(z.coerce.bigint(), "22")).toBe(22n);
      });
      it("coerces dates to numbers", () => {
        expect(
          serializeAndParse(z.coerce.number(), new Date("2024-01-01")),
        ).toBe(+new Date("2024-01-01"));
      });
    });
  });
  describe("boolean", () => {
    it("serializes and parses a boolean", () => {
      expect(serializeAndParse(z.boolean(), true)).toBe(true);
    });
    it("coerces the value to boolean", () => {
      expect(serializeAndParse(z.coerce.boolean(), 1)).toBe(true);
    });
    it("doesn't coerce the value if it shouln't", () => {
      expect(() => serializeAndParse(z.boolean(), 1)).toThrow();
    });
  });
  describe("date", () => {
    it("serializes and parses a date", () => {
      expect(serializeAndParse(z.date(), new Date("2024-01-01"))).toEqual(
        new Date("2024-01-01"),
      );
    });
    it("coerces the value to a date", () => {
      expect(serializeAndParse(z.coerce.date(), 946684800000)).toEqual(
        new Date("2000-01-01"),
      );
    });
    it("doesn't coerce the value if it shouldn't", () => {
      expect(() => serializeAndParse(z.date(), 946684800000)).toThrow();
    });
  });
  describe("undefined", () => {
    it("serializes and parses undefined", () => {
      expect(serializeAndParse(z.undefined(), undefined)).toBe(undefined);
    });
    it("works also with .optional()", () => {
      expect(serializeAndParse(z.string().optional(), undefined)).toBe(
        undefined as any,
      );
    });
    it("works also with .nullish()", () => {
      expect(serializeAndParse(z.string().nullish(), undefined)).toBe(
        undefined as any,
      );
    });
    it("fails if the value is not optional", () => {
      expect(() => serializeAndParse(z.string(), undefined)).toThrow();
    });
  });
  describe("null", () => {
    it("serializes and parses null", () => {
      expect(serializeAndParse(z.null(), null)).toBe(null);
    });
    it("works also with .nullable()", () => {
      expect(serializeAndParse(z.string().nullable(), null)).toBe(null);
    });
    it("works also with .nullish()", () => {
      expect(serializeAndParse(z.string().nullish(), null)).toBe(null);
    });
    it("fails if the value is not nullabe", () => {
      expect(() => serializeAndParse(z.string(), null)).toThrow();
    });
  });
  describe("array like", () => {
    describe("array", () => {
      it("serializes and parses an array", () => {
        expect(serializeAndParse(z.array(z.string()), ["hello"])).toEqual([
          "hello",
        ]);
      });
      it("serializes and parses an medium sized array", () => {
        const value = Array.from({ length: 500 }).map((_, i) => i);
        expect(serializeAndParse(z.array(z.number()), value)).toEqual(value);
      });
      it("serializes and parses an long array", () => {
        const value = Array.from({ length: 5_000 }).map((_, i) => i);
        expect(serializeAndParse(z.array(z.number()), value)).toEqual(value);
      });
      // This test is skipped in development mode because it takes a long time to run
      it("fails if array is to long", () => {
        const value = Array.from({ length: 2 ** 19 });
        expect(() =>
          serializeAndParse(z.array(z.boolean().optional()), value),
        ).toThrow();
      });
      it("fails if the value is not an array", () => {
        expect(() => serializeAndParse(z.array(z.string()), "hello")).toThrow();
      });
      it("fails if the array contains invalid values", () => {
        expect(() =>
          serializeAndParse(z.array(z.string()), ["hello", 33]),
        ).toThrow();
      });
    });
    describe("set", () => {
      it("serializes and parses a set", () => {
        expect(
          serializeAndParse(z.set(z.string()), new Set(["hello"])),
        ).toEqual(new Set(["hello"]));
      });
      it("serializes and parses a big set", () => {
        const value = new Set(Array.from({ length: 10_000 }).map((_, i) => i));
        expect(serializeAndParse(z.set(z.number()), value)).toEqual(value);
      });
      it("fails if the value is not a set", () => {
        expect(() => serializeAndParse(z.set(z.string()), "hello")).toThrow();
      });
      it("fails if the set contains invalid values", () => {
        expect(() =>
          serializeAndParse(z.set(z.string()), new Set(["hello", 33])),
        ).toThrow();
      });
    });
    describe("tuple", () => {
      it("serializes and parses a tuple", () => {
        expect(
          serializeAndParse(z.tuple([z.string(), z.number()]), ["hello", 33]),
        ).toEqual(["hello", 33]);
      });
    });
  });
  describe("object", () => {
    const schema = z.object({
      string: z.string(),
      optional: z.string().optional(),
      nullish: z.string().nullish(),
    });
    it("serializes and parses an object", () => {
      expect(
        serializeAndParse(schema, {
          string: "hello",
          optional: "world",
          nullish: null,
        }),
      ).toStrictEqual({ string: "hello", optional: "world", nullish: null });
    });
    it("handles passes trough undefined as a value", () => {
      expect(
        serializeAndParse(schema, {
          string: "hello",
          optional: undefined,
          nullish: "world",
        }),
      ).toStrictEqual({
        string: "hello",
        optional: undefined,
        nullish: "world",
      });
    });
    it("handles passes trough an missing optional property", () => {
      expect(serializeAndParse(schema, { string: "hello" })).toStrictEqual({
        string: "hello",
      });
    });
  });
  describe("map", () => {
    it("serializes and parses a map", () => {
      const value = new Map([
        ["hello", 33],
        ["world", 44],
      ]);
      expect(serializeAndParse(z.map(z.string(), z.number()), value)).toEqual(
        value,
      );
    });
    it("serializes and parses a long map", () => {
      const value = new Map(
        Array.from({ length: 2 ** 10 }).map((_, i) => [i.toString(), i]),
      );
      expect(serializeAndParse(z.map(z.string(), z.number()), value)).toEqual(
        value,
      );
    });
    it("serializes and parses a record", () => {
      const value = Object.fromEntries([
        ["hello", 33],
        ["world", 44],
      ]);
      expect(
        serializeAndParse(z.record(z.string(), z.number()), value),
      ).toEqual(value);
    });
  });
  describe("intersection", () => {
    it("serializes and parses an object intersection", () => {
      const schema = z.intersection(
        z.object({ a: z.string() }),
        z.object({ b: z.number() }),
      );
      expect(serializeAndParse(schema, { a: "hello", b: 33 })).toEqual({
        a: "hello",
        b: 33,
      });
    });
    describe("union", () => {
      it("number", () => {
        const schema = z.intersection(
          z.union([z.string(), z.number()]),
          z.union([z.boolean(), z.number()]),
        );
        expect(serializeAndParse(schema, 2)).toEqual(2);
      });
      it("string", () => {
        const schema = z.intersection(
          z.union([z.string(), z.number()]),
          z.union([z.string(), z.boolean()]),
        );
        expect(serializeAndParse(schema, "")).toEqual("");
      });
      it("boolean", () => {
        const schema = z.intersection(
          z.union([z.boolean(), z.number()]),
          z.union([z.string(), z.boolean()]),
        );
        expect(serializeAndParse(schema, false)).toEqual(false);
      });
      it.todo("object", () => {
        const schema = z.intersection(
          z.union([z.object({ foo: z.string() }), z.number()]),
          z.union([z.object({ bar: z.string() }), z.string()]),
        );
        expect(serializeAndParse(schema, { foo: "foo", bar: "bar" })).toEqual({
          foo: "foo",
          bar: "bar",
        });
      });
    });
  });
  describe("union", () => {
    it("serializes and parses a union", () => {
      const schema = z.union([z.string(), z.number()]);
      expect(serializeAndParse(schema, "hello")).toEqual("hello");
      expect(serializeAndParse(schema, 33)).toEqual(33);
    });
    it("fails if the value is not in the union", () => {
      const schema = z.union([z.string(), z.number()]);
      expect(() => serializeAndParse(schema, true)).toThrow();
    });
    it("works with undefined", () => {
      const schema = z.union([z.string(), z.undefined()]);
      expect(serializeAndParse(schema, undefined)).toBe(undefined as any);
    });
    it("works with null", () => {
      const schema = z.union([z.string(), z.null()]);
      expect(serializeAndParse(schema, null)).toBe(null);
    });
    it("works with discriminated union", () => {
      const schema = z.discriminatedUnion("foo", [
        z.object({ foo: z.literal(1) }),
        z.object({ foo: z.literal(2), bar: z.string() }),
      ]);
      expect(serializeAndParse(schema, { foo: 1 })).toEqual({
        foo: 1,
      });
      expect(serializeAndParse(schema, { foo: 2, bar: "bar" })).toEqual({
        foo: 2,
        bar: "bar",
      });
    });
    it("works with all members of the union", () => {
      const schema = z.union(
        Array.from({ length: 31 }).map((_, i) => z.literal(i)) as any,
      );
      Array.from({ length: 31 }).forEach((_, value) => {
        expect(serializeAndParse(schema, value)).toBe(value);
      });
    });
    it("fails if the union has too many members", () => {
      expect(() =>
        serializeAndParse(
          z.union(
            Array.from({ length: 33 }).map((_, i) => z.literal(i)) as any,
          ),
          1,
        ),
      ).toThrow();
    });
  });
  describe("literal", () => {
    it("serializes and parses a string literal", () => {
      expect(serializeAndParse(z.literal("hello"), "hello")).toBe("hello");
    });
    it("serializes and parses a number literal", () => {
      expect(serializeAndParse(z.literal(42), 42)).toBe(42);
    });
    it("serializes and parses a bigint literal", () => {
      expect(serializeAndParse(z.literal(42n), 42n)).toBe(42n);
    });
    it("serializes and parses a boolean literal", () => {
      expect(serializeAndParse(z.literal(false), false)).toBe(false);
    });
    it("serializes and parses a undefined literal", () => {
      expect(serializeAndParse(z.literal(undefined), undefined)).toBe(
        undefined,
      );
    });
    it("serializes and parses a null literal", () => {
      expect(serializeAndParse(z.literal(null), null)).toBe(null);
    });
  });
  describe("enum", () => {
    it("serializes and parses an enum", () => {
      const schema = z.enum(["hello", "world"]);
      expect(serializeAndParse(schema, "hello")).toBe("hello");
      expect(serializeAndParse(schema, "world")).toBe("world");
    });
    it("serializes and parses an native enum with string values", () => {
      enum MyEnum {
        Hello = "hello",
        World = "world",
      }
      const schema = z.nativeEnum(MyEnum);
      expect(serializeAndParse(schema, "hello")).toBe(MyEnum.Hello);
      expect(serializeAndParse(schema, "world")).toBe(MyEnum.World);
    });
    it("serializes and parses an native enum with numeric values", () => {
      enum MyEnum {
        Hello,
        World,
      }
      const schema = z.nativeEnum(MyEnum);
      expect(serializeAndParse(schema, 0)).toBe(MyEnum.Hello);
      expect(serializeAndParse(schema, 1)).toBe(MyEnum.World);
    });
    it("serializes and parses an native enum with mixed values", () => {
      enum MyEnum {
        Hello,
        World = "world",
      }
      const schema = z.nativeEnum(MyEnum);
      expect(serializeAndParse(schema, 0)).toBe(MyEnum.Hello);
      expect(serializeAndParse(schema, "world")).toBe(MyEnum.World);
    });
  });
  describe("unwrappers", () => {
    test("default", () => {
      const schema = z.string().default("hello");
      expect(serializeAndParse(schema, undefined)).toBe("hello");
      expect(serializeAndParse(schema, "bar")).toBe("bar");
    });
    test("optional", () => {
      const schema = z.string().optional();
      expect(serializeAndParse(schema, "foo")).toBe("foo");
      expect(serializeAndParse(schema, undefined)).toBe(undefined as any);
    });
    test("nullable", () => {
      const schema = z.string().nullable();
      expect(serializeAndParse(schema, "foo")).toBe("foo");
      expect(serializeAndParse(schema, null)).toBe(null);
    });
    test("catch", () => {
      const schema = z.string().catch(() => "hello");
      expect(serializeAndParse(schema, "foo")).toBe("foo");
      expect(serializeAndParse(schema, 33)).toBe("hello");
    });
    test("readonly", () => {
      const schema = z.object({ foo: z.string() }).readonly();
      expect(serializeAndParse(schema, { foo: "foo" })).toEqual({ foo: "foo" });
    });
    test("brand", () => {
      const schema = z.object({ id: z.number() }).brand<"userId">();
      expect(serializeAndParse(schema, { id: 1 })).toEqual({ id: 1 });
    });
    test("lazy", () => {
      let schema: z.ZodObject<any>;
      const schema2 = z.object({
        bar: z.string(),
        recursive: z.lazy(() => schema).optional(),
      });
      schema = z.object({ foo: schema2 });
      const inner = { foo: { bar: "bar" } };
      const value = {
        foo: {
          bar: "1",
          recursive: inner,
        },
      };
      value.foo.recursive = value;
      // @ts-expect-error recursive value
      value.foo.recursive.foo.recursive = inner;
      expect(serializeAndParse(schema, value)).toEqual(value);
    });
    test("pipe", () => {
      const schema = z
        .string()
        .transform((x) => x.length)
        .pipe(z.number());
      expect(serializeAndParse(schema, "hello")).toBe(5);
    });
    test("preprocess", () => {
      const schema = z.preprocess((x) => String(x), z.string());
      expect(serializeAndParse(schema, 123)).toBe("123");
    });
    test("preprocess needs to happen during serialization", () => {
      const schema = z.preprocess((x, ctx) => {
        if (Array.isArray(x)) {
          return x;
        }
        if (typeof x === "number") {
          return Array.from({ length: x }).map((_, i) => i);
        }
        ctx.addIssue({
          code: "invalid_type",
          expected: "number",
          received: typeof x,
        });
      }, z.array(z.number()));
      expect(() => serializeAndParse(schema, "3")).toThrow();
      expect(serializeAndParse(schema, 3)).toEqual([0, 1, 2]);
    });
    test("refine", () => {
      const schema = z.string().refine((s) => s.length > 3);
      expect(serializeAndParse(schema, "asdf")).toBe("asdf");
      expect(() => serializeAndParse(schema, "as")).toThrow();
    });
    test("transform", () => {
      const schema = z
        .string()
        .nullish()
        .transform((s) => s ?? null);
      expect(serializeAndParse(schema, "asdf")).toBe("asdf");
      expect(serializeAndParse(schema, null)).toBe(null);
      expect(serializeAndParse(schema, undefined)).toBe(null);
    });
    test("transform inside catch", () => {
      const schema = z
        .object({
          foo: z
            .string()
            .transform((s) => s.length)
            .pipe(z.number()),
        })
        .catch(() => ({ foo: 1234 }));
      expect(serializeAndParse(schema, { foo: "adf" })).toEqual({ foo: 3 });
      // catch happend outside of the transform.
      // so the transform was applied because of the catch.
      // so the transform cannot be serialized since the schema has changed
      // catch needs to happen during the serialization process
      // all other transformations are applied after the parsing process
      expect(() => serializeAndParse(schema, { fooasdf: 1 })).toThrow();
    });
  });
  it("works with complex objects", () => {
    const complexSchema = z.object({
      id: z.number(),
      name: z.string(),
      email: z.string().email(),
      isAdmin: z.boolean(),
      roles: z.array(z.enum(["admin", "mod"])),
      lastLogin: z.date(),
      birthDate: z.date().optional(),
      things: z.array(z.string()).nullable(),
      fooUnion: z.union([z.string(), z.number()]),
      fooDiscriminatedUnion: z.discriminatedUnion("foo", [
        z.object({ foo: z.literal("foo"), bar: z.number() }),
        z.object({ foo: z.literal("bar"), baz: z.string() }),
      ]),
      nesting: z.object({
        foo: z.object({
          bar: z.object({
            baz: z.string(),
          }),
        }),
      }),
      tuple: z.tuple([z.string(), z.number()]),
      tuple2: z.tuple([z.string(), z.number()]).readonly(),
      set: z.set(z.string()),
      map: z.map(z.number(), z.number()),
      record: z.record(z.string(), z.number()),
      foobar: z.object({ foo: z.string() }).and(z.object({ bar: z.string() })),
      related: z.array(
        z.object({
          id: z.nan(),
          age: z.number(),
          name: z.string(),
        }),
      ),
    });

    const value: z.infer<typeof complexSchema> = {
      id: -3,
      name: "aaaaa",
      email: "aaaaaa@aa.com",
      isAdmin: true,
      roles: ["admin", "mod", "admin"],
      lastLogin: new Date("2024-01-01"),
      birthDate: undefined,
      things: null,
      fooUnion: "",
      nesting: {
        foo: {
          bar: {
            baz: "baz",
          },
        },
      },
      fooDiscriminatedUnion: { foo: "foo", bar: 3 },
      set: new Set(["foo", "bar"]),
      tuple: ["foo", 3],
      tuple2: ["foo", 3],
      foobar: { foo: "foo", bar: "bar" },
      map: new Map([
        [1, 2],
        [3, 4],
      ]),
      record: {
        foo: 1,
        bar: 2,
      },
      related: [
        {
          id: NaN,
          age: Infinity,
          name: "",
        },
        {
          id: NaN,
          age: 1234567890,
          name: "asdfajslkdföjdskfjölsdjökdlajöflkjasöfjsdalk😀",
        },
      ],
    };
    expect(serializeAndParse(complexSchema, value)).toEqual(value);
  });
});
