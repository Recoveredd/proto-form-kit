# proto-form-kit

Turn Protocol Buffer source text into form-friendly metadata, service input/output hints and safe JSON examples.

`proto-form-kit` is meant for admin tools, API explorers, docs generators and internal dashboards that need to inspect a `.proto` file in the browser or in Node without generating a gRPC client.

## Install

```bash
npm install proto-form-kit
```

## Quick start

```ts
import {
  createProtoMethodExample,
  createProtoExample,
  getMethodFormSchema,
  parseProtoFormSchema
} from 'proto-form-kit';

const schema = parseProtoFormSchema(`
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
  }

  enum Status {
    STATUS_UNKNOWN = 0;
    STATUS_ACTIVE = 1;
  }

  service ProductCatalog {
    rpc ListProducts(ListProductsRequest) returns (ListProductsResponse);
  }
`);

const method = getMethodFormSchema(schema, 'ProductCatalog', 'ListProducts');
const example = createProtoExample(schema, 'ListProductsRequest');
const methodExample = createProtoMethodExample(schema, 'ProductCatalog', 'ListProducts');

console.log(method?.input?.fields);
console.log(example);
// {
//   query: '',
//   tags: [''],
//   limitsByRegion: { key: 0 }
// }

console.log(methodExample?.input);
console.log(methodExample?.output);
```

## API

### `parseProtoFormSchema(source, options?)`

Parses `.proto` source text and returns a serializable schema object:

```ts
const schema = parseProtoFormSchema(protoText, {
  keepCase: true,
  alternateCommentMode: true
});
```

The returned schema contains:

- `packageName`
- `imports` and `weakImports`
- flattened `messages`
- flattened `enums`
- flattened `services`
- `diagnostics`

By default `keepCase` is `true`, so field names preserve the `.proto` source name while each field also receives a `jsonName` helper in lower camel case.

### `getMessageFormSchema(schema, messageName)`

Finds a message by short name or fully qualified name.

```ts
const message = getMessageFormSchema(schema, 'demo.inventory.ListProductsRequest');
```

### `getMethodFormSchema(schema, serviceName, methodName)`

Finds a service method and resolves its input/output message schemas when available.

```ts
const method = getMethodFormSchema(schema, 'ProductCatalog', 'ListProducts');

console.log(method?.input?.fields);
console.log(method?.output?.fields);
```

The result includes method streaming metadata:

```ts
method?.method.clientStreaming;
method?.method.serverStreaming;
```

### `createProtoMethodExample(schema, serviceName, methodName, options?)`

Builds JSON-friendly input and output examples for a service method.

```ts
const examples = createProtoMethodExample(schema, 'ProductCatalog', 'ListProducts');

console.log(examples?.input);
console.log(examples?.output);
console.log(examples?.diagnostics);
```

This is the quickest helper when you are building a small API explorer or documentation page from a service definition.

### `createProtoExample(schema, messageName, options?)`

Builds a JSON-friendly example object from a message schema.

```ts
const example = createProtoExample(schema, 'ListProductsRequest', {
  maxDepth: 3,
  includeOneof: true
});
```

Example generation rules:

- scalar numbers become `0`
- `int64`, `uint64` and other long integer fields become `'0'`, matching protobuf JSON string encoding
- strings and bytes become `''`
- booleans become `false`
- enums use the first declared enum value name
- repeated fields become one-item arrays
- maps become one-entry objects
- recursive messages stop at `maxDepth`
- oneof groups include the first field by default, or no field when `includeOneof: false`

## Form metadata

Each field includes a neutral `control` hint so UI code does not have to reverse-engineer protobuf types every time:

```ts
const product = schema.messages.find((message) => message.name === 'Product');

for (const field of product?.fields ?? []) {
  console.log(field.name, field.control);
}
```

Control values are:

- `text` for strings
- `number` for numeric scalar fields
- `checkbox` for booleans
- `bytes` for bytes
- `select` for enum fields
- `fieldset` for message fields
- `list` for repeated fields
- `map` for map fields
- `unknown` for unresolved types

Enum fields also expose `enumValues` directly:

```ts
const statusField = product?.fields.find((field) => field.name === 'status');

console.log(statusField?.enumValues);
// [
//   { name: 'STATUS_UNKNOWN', value: 0 },
//   { name: 'STATUS_ACTIVE', value: 1 }
// ]
```

## Supported schema features

`proto-form-kit` supports the reflection features usually needed to generate forms or API examples:

- messages and nested messages
- enums and nested enums
- services and unary or streaming methods
- scalar, enum and message fields
- repeated fields
- map fields
- oneof groups
- comments when `alternateCommentMode` is enabled
- diagnostics for parse errors, unresolved imports and unresolved field types

## Imports

The library parses source text only. It does not fetch files and it does not call `Root.load`, which keeps it browser-friendly and predictable.

If a schema declares imports, the import names are returned and a warning diagnostic is added:

```ts
const schema = parseProtoFormSchema(`
  syntax = "proto3";
  import "google/protobuf/timestamp.proto";
  message Event {
    google.protobuf.Timestamp created_at = 1;
  }
`);

console.log(schema.imports);
console.log(schema.diagnostics);
```

If you need imported types to resolve, concatenate or preprocess the relevant `.proto` sources before calling `parseProtoFormSchema`.

## What it is not

This package is not a protobuf encoder, decoder, validator or gRPC client generator. It is a small metadata layer for tooling UI, documentation and examples.

Use `protobufjs`, `buf`, `protoc`, `connect-es` or generated clients when you need runtime protobuf messages or RPC calls.

## License

MPL-2.0
