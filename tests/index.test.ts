import { describe, expect, it } from 'vitest';
import {
  createProtoMethodExample,
  createProtoExample,
  getMessageFormSchema,
  getMethodFormSchema,
  parseProtoFormSchema
} from '../src/index.js';

const inventoryProto = `
syntax = "proto3";

package demo.inventory;

message ListProductsRequest {
  string query = 1;
  repeated string tags = 2;
  map<string, int32> limits_by_region = 3;
}

message ListProductsResponse {
  repeated Product products = 1;
}

message Product {
  string id = 1;
  Status status = 2;

  oneof price {
    int64 cents = 3;
    string custom_quote = 4;
  }
}

enum Status {
  STATUS_UNKNOWN = 0;
  STATUS_ACTIVE = 1;
}

service ProductCatalog {
  rpc ListProducts(ListProductsRequest) returns (ListProductsResponse);
  rpc WatchProducts(stream ListProductsRequest) returns (stream ListProductsResponse);
}
`;

describe('parseProtoFormSchema', () => {
  it('extracts messages, fields, enums and services from proto text', () => {
    const schema = parseProtoFormSchema(inventoryProto);

    expect(schema.ok).toBe(true);
    expect(schema.packageName).toBe('demo.inventory');
    expect(schema.messages.map((message) => message.name)).toContain('Product');
    expect(schema.enums[0]?.values).toEqual([
      { name: 'STATUS_UNKNOWN', value: 0 },
      { name: 'STATUS_ACTIVE', value: 1 }
    ]);

    const request = getMessageFormSchema(schema, 'demo.inventory.ListProductsRequest');

    expect(request?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'tags',
          kind: 'scalar',
          control: 'list',
          label: 'repeated',
          repeated: true
        }),
        expect.objectContaining({
          name: 'limits_by_region',
          jsonName: 'limitsByRegion',
          kind: 'map',
          control: 'map',
          keyType: 'string',
          valueType: 'int32',
          valueKind: 'scalar'
        })
      ])
    );
  });

  it('resolves unary and streaming service methods', () => {
    const schema = parseProtoFormSchema(inventoryProto);
    const unary = getMethodFormSchema(schema, 'ProductCatalog', 'ListProducts');
    const streaming = getMethodFormSchema(schema, 'demo.inventory.ProductCatalog', 'WatchProducts');

    expect(unary?.input?.name).toBe('ListProductsRequest');
    expect(unary?.output?.name).toBe('ListProductsResponse');
    expect(unary?.method.clientStreaming).toBe(false);
    expect(unary?.method.serverStreaming).toBe(false);
    expect(streaming?.method.clientStreaming).toBe(true);
    expect(streaming?.method.serverStreaming).toBe(true);
  });

  it('creates bounded JSON examples with oneof and map fields', () => {
    const schema = parseProtoFormSchema(inventoryProto);
    const example = createProtoExample(schema, 'Product');

    expect(example).toEqual({
      id: '',
      status: 'STATUS_UNKNOWN',
      cents: '0'
    });

    const requestExample = createProtoExample(schema, 'ListProductsRequest');

    expect(requestExample).toEqual({
      query: '',
      tags: [''],
      limitsByRegion: { key: 0 }
    });
  });

  it('exposes enum values and method input/output examples for form UIs', () => {
    const schema = parseProtoFormSchema(inventoryProto);
    const product = getMessageFormSchema(schema, 'Product');
    const status = product?.fields.find((field) => field.name === 'status');
    const methodExample = createProtoMethodExample(schema, 'ProductCatalog', 'ListProducts');

    expect(status).toEqual(
      expect.objectContaining({
        kind: 'enum',
        control: 'select',
        enumValues: [
          { name: 'STATUS_UNKNOWN', value: 0 },
          { name: 'STATUS_ACTIVE', value: 1 }
        ]
      })
    );
    expect(methodExample?.input).toEqual({
      query: '',
      tags: [''],
      limitsByRegion: { key: 0 }
    });
    expect(methodExample?.output).toEqual({
      products: [
        {
          id: '',
          status: 'STATUS_UNKNOWN',
          cents: '0'
        }
      ]
    });
  });

  it('can skip oneof values in generated examples', () => {
    const schema = parseProtoFormSchema(inventoryProto);

    expect(createProtoExample(schema, 'Product', { includeOneof: false })).toEqual({
      id: '',
      status: 'STATUS_UNKNOWN'
    });
  });

  it('does not recurse forever on recursive messages', () => {
    const schema = parseProtoFormSchema(`
      syntax = "proto3";
      message Node {
        string label = 1;
        Node child = 2;
      }
    `);

    expect(createProtoExample(schema, 'Node')).toEqual({
      label: '',
      child: {}
    });
  });

  it('reports imports as not loaded when only source text is parsed', () => {
    const schema = parseProtoFormSchema(`
      syntax = "proto3";
      import "google/protobuf/timestamp.proto";
      message Event {
        google.protobuf.Timestamp created_at = 1;
      }
    `);

    expect(schema.ok).toBe(true);
    expect(schema.imports).toEqual(['google/protobuf/timestamp.proto']);
    expect(schema.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'import_not_loaded',
          severity: 'warning'
        }),
        expect.objectContaining({
          code: 'type_resolution',
          severity: 'warning'
        })
      ])
    );
  });

  it('returns a parse diagnostic instead of throwing on invalid proto text', () => {
    const schema = parseProtoFormSchema('message Broken { string value = ; }');

    expect(schema.ok).toBe(false);
    expect(schema.messages).toEqual([]);
    expect(schema.diagnostics[0]).toEqual(
      expect.objectContaining({
        code: 'parse_error',
        severity: 'error'
      })
    );
  });
});
