import * as protobuf from 'protobufjs';

export type ProtoDiagnosticSeverity = 'error' | 'warning' | 'info';

export interface ProtoDiagnostic {
  code:
    | 'parse_error'
    | 'import_not_loaded'
    | 'type_resolution'
    | 'unsupported_field_type'
    | 'message_not_found'
    | 'method_not_found';
  severity: ProtoDiagnosticSeverity;
  message: string;
  path?: string;
}

export interface ProtoEnumValueSchema {
  name: string;
  value: number;
  comment?: string;
}

export interface ProtoEnumSchema {
  name: string;
  fullName: string;
  values: ProtoEnumValueSchema[];
  comment?: string;
  path: string;
}

export type ProtoFieldKind = 'scalar' | 'enum' | 'message' | 'map' | 'unknown';
export type ProtoFieldLabel = 'optional' | 'required' | 'repeated' | 'map';

export interface ProtoFieldSchema {
  name: string;
  jsonName: string;
  id: number;
  type: string;
  kind: ProtoFieldKind;
  label: ProtoFieldLabel;
  repeated: boolean;
  required: boolean;
  optional: boolean;
  map: boolean;
  keyType?: string;
  valueType?: string;
  valueKind?: Exclude<ProtoFieldKind, 'map'>;
  oneof?: string;
  defaultValue?: unknown;
  comment?: string;
  path: string;
}

export interface ProtoOneofSchema {
  name: string;
  fields: string[];
  comment?: string;
  path: string;
}

export interface ProtoMessageSchema {
  name: string;
  fullName: string;
  fields: ProtoFieldSchema[];
  oneofs: ProtoOneofSchema[];
  nestedMessages: ProtoMessageSchema[];
  nestedEnums: ProtoEnumSchema[];
  comment?: string;
  path: string;
}

export interface ProtoMethodSchema {
  name: string;
  inputType: string;
  outputType: string;
  clientStreaming: boolean;
  serverStreaming: boolean;
  comment?: string;
  path: string;
}

export interface ProtoServiceSchema {
  name: string;
  fullName: string;
  methods: ProtoMethodSchema[];
  comment?: string;
  path: string;
}

export interface ProtoFormSchema {
  ok: boolean;
  packageName?: string;
  imports: string[];
  weakImports: string[];
  messages: ProtoMessageSchema[];
  enums: ProtoEnumSchema[];
  services: ProtoServiceSchema[];
  diagnostics: ProtoDiagnostic[];
}

export interface ProtoFormParseOptions {
  keepCase?: boolean;
  alternateCommentMode?: boolean;
}

export interface ProtoExampleOptions {
  maxDepth?: number;
  includeOneof?: boolean;
}

export interface ProtoMethodFormSchema {
  service: ProtoServiceSchema;
  method: ProtoMethodSchema;
  input: ProtoMessageSchema | null;
  output: ProtoMessageSchema | null;
  diagnostics: ProtoDiagnostic[];
}

const SCALAR_TYPES = new Set([
  'double',
  'float',
  'int32',
  'int64',
  'uint32',
  'uint64',
  'sint32',
  'sint64',
  'fixed32',
  'fixed64',
  'sfixed32',
  'sfixed64',
  'bool',
  'string',
  'bytes'
]);

const INTEGER_TYPES = new Set(['int32', 'uint32', 'sint32', 'fixed32', 'sfixed32']);
const LONG_TYPES = new Set(['int64', 'uint64', 'sint64', 'fixed64', 'sfixed64']);
const FLOAT_TYPES = new Set(['double', 'float']);

export function parseProtoFormSchema(source: string, options: ProtoFormParseOptions = {}): ProtoFormSchema {
  const diagnostics: ProtoDiagnostic[] = [];

  try {
    const parsed = protobuf.parse(source, {
      keepCase: options.keepCase ?? true,
      alternateCommentMode: options.alternateCommentMode ?? true
    });

    const imports = parsed.imports ?? [];
    const weakImports = parsed.weakImports ?? [];

    for (const fileName of [...imports, ...weakImports]) {
      diagnostics.push({
        code: 'import_not_loaded',
        severity: 'warning',
        message: `Import "${fileName}" is declared but not loaded from source text.`,
        path: fileName
      });
    }

    try {
      parsed.root.resolveAll();
    } catch (error) {
      diagnostics.push({
        code: 'type_resolution',
        severity: 'warning',
        message: getErrorMessage(error)
      });
    }

    const messages = collectMessages(parsed.root);
    const enums = collectEnums(parsed.root);
    const services = collectServices(parsed.root);

    for (const message of messages) {
      for (const field of message.fields) {
        if (field.kind === 'unknown' || field.valueKind === 'unknown') {
          diagnostics.push({
            code: 'unsupported_field_type',
            severity: 'warning',
            message: `Field "${field.path}" references an unresolved or unsupported type "${field.type}".`,
            path: field.path
          });
        }
      }
    }

    return {
      ok: !diagnostics.some((diagnostic) => diagnostic.severity === 'error'),
      packageName: parsed.package,
      imports,
      weakImports,
      messages,
      enums,
      services,
      diagnostics
    };
  } catch (error) {
    return emptySchema({
      code: 'parse_error',
      severity: 'error',
      message: getErrorMessage(error)
    });
  }
}

export function getMessageFormSchema(
  schema: ProtoFormSchema,
  messageName: string
): ProtoMessageSchema | null {
  const normalizedName = normalizeLookupName(messageName);
  return (
    schema.messages.find(
      (message) =>
        normalizeLookupName(message.name) === normalizedName ||
        normalizeLookupName(message.fullName) === normalizedName
    ) ?? null
  );
}

export function getMethodFormSchema(
  schema: ProtoFormSchema,
  serviceName: string,
  methodName: string
): ProtoMethodFormSchema | null {
  const normalizedServiceName = normalizeLookupName(serviceName);
  const normalizedMethodName = methodName.toLowerCase();
  const service =
    schema.services.find(
      (candidate) =>
        normalizeLookupName(candidate.name) === normalizedServiceName ||
        normalizeLookupName(candidate.fullName) === normalizedServiceName
    ) ?? null;

  if (!service) {
    return null;
  }

  const method =
    service.methods.find((candidate) => candidate.name.toLowerCase() === normalizedMethodName) ??
    null;

  if (!method) {
    return null;
  }

  const diagnostics: ProtoDiagnostic[] = [];
  const input = getMessageFormSchema(schema, method.inputType);
  const output = getMessageFormSchema(schema, method.outputType);

  if (!input) {
    diagnostics.push({
      code: 'message_not_found',
      severity: 'warning',
      message: `Input message "${method.inputType}" was not found in the parsed schema.`,
      path: method.path
    });
  }

  if (!output) {
    diagnostics.push({
      code: 'message_not_found',
      severity: 'warning',
      message: `Output message "${method.outputType}" was not found in the parsed schema.`,
      path: method.path
    });
  }

  return { service, method, input, output, diagnostics };
}

export function createProtoExample(
  schema: ProtoFormSchema,
  messageName: string,
  options: ProtoExampleOptions = {}
): Record<string, unknown> | null {
  const message = getMessageFormSchema(schema, messageName);
  if (!message) {
    return null;
  }

  return buildMessageExample(schema, message, options, 0, new Set());
}

function emptySchema(diagnostic: ProtoDiagnostic): ProtoFormSchema {
  return {
    ok: false,
    imports: [],
    weakImports: [],
    messages: [],
    enums: [],
    services: [],
    diagnostics: [diagnostic]
  };
}

function collectMessages(namespace: protobuf.NamespaceBase): ProtoMessageSchema[] {
  const messages: ProtoMessageSchema[] = [];

  for (const item of namespace.nestedArray) {
    if (item instanceof protobuf.Type) {
      messages.push(buildMessageSchema(item));
      messages.push(...collectMessages(item));
    } else if (item instanceof protobuf.Namespace) {
      messages.push(...collectMessages(item));
    }
  }

  return messages;
}

function collectEnums(namespace: protobuf.NamespaceBase): ProtoEnumSchema[] {
  const enums: ProtoEnumSchema[] = [];

  for (const item of namespace.nestedArray) {
    if (item instanceof protobuf.Enum) {
      enums.push(buildEnumSchema(item));
    } else if (item instanceof protobuf.Type || item instanceof protobuf.Namespace) {
      enums.push(...collectEnums(item));
    }
  }

  return enums;
}

function collectServices(namespace: protobuf.NamespaceBase): ProtoServiceSchema[] {
  const services: ProtoServiceSchema[] = [];

  for (const item of namespace.nestedArray) {
    if (item instanceof protobuf.Service) {
      services.push(buildServiceSchema(item));
    } else if (item instanceof protobuf.Type || item instanceof protobuf.Namespace) {
      services.push(...collectServices(item));
    }
  }

  return services;
}

function buildMessageSchema(message: protobuf.Type): ProtoMessageSchema {
  return {
    name: message.name,
    fullName: stripLeadingDot(message.fullName),
    fields: message.fieldsArray.map((field) => buildFieldSchema(field, message)),
    oneofs: message.oneofsArray.map((oneof) => ({
      name: oneof.name,
      fields: [...oneof.oneof],
      comment: oneof.comment ?? undefined,
      path: joinPath(message.fullName, oneof.name)
    })),
    nestedMessages: message.nestedArray
      .filter((item): item is protobuf.Type => item instanceof protobuf.Type)
      .map((item) => buildMessageSchema(item)),
    nestedEnums: message.nestedArray
      .filter((item): item is protobuf.Enum => item instanceof protobuf.Enum)
      .map((item) => buildEnumSchema(item)),
    comment: message.comment ?? undefined,
    path: stripLeadingDot(message.fullName)
  };
}

function buildEnumSchema(protoEnum: protobuf.Enum): ProtoEnumSchema {
  return {
    name: protoEnum.name,
    fullName: stripLeadingDot(protoEnum.fullName),
    values: Object.entries(protoEnum.values).map(([name, value]) => ({
      name,
      value,
      comment: protoEnum.comments[name] ?? undefined
    })),
    comment: protoEnum.comment ?? undefined,
    path: stripLeadingDot(protoEnum.fullName)
  };
}

function buildServiceSchema(service: protobuf.Service): ProtoServiceSchema {
  return {
    name: service.name,
    fullName: stripLeadingDot(service.fullName),
    methods: service.methodsArray.map((method) => ({
      name: method.name,
      inputType: stripLeadingDot(method.requestType),
      outputType: stripLeadingDot(method.responseType),
      clientStreaming: method.requestStream ?? false,
      serverStreaming: method.responseStream ?? false,
      comment: method.comment ?? undefined,
      path: joinPath(service.fullName, method.name)
    })),
    comment: service.comment ?? undefined,
    path: stripLeadingDot(service.fullName)
  };
}

function buildFieldSchema(field: protobuf.Field, message: protobuf.Type): ProtoFieldSchema {
  const isMap = field instanceof protobuf.MapField;
  const keyType = isMap ? field.keyType : undefined;
  const valueKind = resolveFieldKind(field);
  const kind = isMap ? 'map' : valueKind;
  const fieldSchema: ProtoFieldSchema = {
    name: field.name,
    jsonName: lowerCamelCase(field.name),
    id: field.id,
    type: field.type,
    kind,
    label: getFieldLabel(field, isMap),
    repeated: field.repeated,
    required: field.required,
    optional: field.optional,
    map: isMap,
    keyType,
    valueType: isMap ? field.type : undefined,
    valueKind: isMap ? valueKind : undefined,
    oneof: field.partOf?.name,
    defaultValue: normalizeDefaultValue(field.defaultValue),
    comment: field.comment ?? undefined,
    path: joinPath(message.fullName, field.name)
  };

  return fieldSchema;
}

function resolveFieldKind(field: protobuf.Field): Exclude<ProtoFieldKind, 'map'> {
  if (SCALAR_TYPES.has(field.type)) {
    return 'scalar';
  }

  if (field.resolvedType instanceof protobuf.Enum) {
    return 'enum';
  }

  if (field.resolvedType instanceof protobuf.Type) {
    return 'message';
  }

  return 'unknown';
}

function getFieldLabel(field: protobuf.Field, isMap: boolean): ProtoFieldLabel {
  if (isMap) {
    return 'map';
  }

  if (field.repeated) {
    return 'repeated';
  }

  if (field.required) {
    return 'required';
  }

  return 'optional';
}

function buildMessageExample(
  schema: ProtoFormSchema,
  message: ProtoMessageSchema,
  options: ProtoExampleOptions,
  depth: number,
  visited: Set<string>
): Record<string, unknown> {
  const maxDepth = options.maxDepth ?? 3;
  const output: Record<string, unknown> = {};
  const selectedOneofs = new Set<string>();

  if (depth >= maxDepth || visited.has(message.fullName)) {
    return output;
  }

  const nextVisited = new Set(visited);
  nextVisited.add(message.fullName);

  for (const field of message.fields) {
    if (field.oneof) {
      if (options.includeOneof === false || selectedOneofs.has(field.oneof)) {
        continue;
      }

      selectedOneofs.add(field.oneof);
    }

    output[field.jsonName] = buildFieldExample(schema, field, options, depth + 1, nextVisited);
  }

  return output;
}

function buildFieldExample(
  schema: ProtoFormSchema,
  field: ProtoFieldSchema,
  options: ProtoExampleOptions,
  depth: number,
  visited: Set<string>
): unknown {
  if (field.map) {
    return {
      [exampleMapKey(field.keyType ?? 'string')]: buildSingleValueExample(
        schema,
        field.valueKind ?? 'unknown',
        field.valueType ?? field.type,
        options,
        depth,
        visited
      )
    };
  }

  const valueKind = field.kind === 'map' ? 'unknown' : field.kind;
  const value = buildSingleValueExample(schema, valueKind, field.type, options, depth, visited);
  return field.repeated ? [value] : value;
}

function buildSingleValueExample(
  schema: ProtoFormSchema,
  kind: Exclude<ProtoFieldKind, 'map'>,
  type: string,
  options: ProtoExampleOptions,
  depth: number,
  visited: Set<string>
): unknown {
  if (kind === 'scalar') {
    return scalarExample(type);
  }

  if (kind === 'enum') {
    const enumSchema = getEnumSchema(schema, type);
    return enumSchema?.values[0]?.name ?? null;
  }

  if (kind === 'message') {
    const message = getMessageFormSchema(schema, type);
    return message ? buildMessageExample(schema, message, options, depth, visited) : {};
  }

  return null;
}

function getEnumSchema(schema: ProtoFormSchema, enumName: string): ProtoEnumSchema | null {
  const normalizedName = normalizeLookupName(enumName);
  return (
    schema.enums.find(
      (protoEnum) =>
        normalizeLookupName(protoEnum.name) === normalizedName ||
        normalizeLookupName(protoEnum.fullName) === normalizedName
    ) ?? null
  );
}

function scalarExample(type: string): unknown {
  if (type === 'bool') {
    return false;
  }

  if (type === 'string') {
    return '';
  }

  if (type === 'bytes') {
    return '';
  }

  if (INTEGER_TYPES.has(type) || FLOAT_TYPES.has(type)) {
    return 0;
  }

  if (LONG_TYPES.has(type)) {
    return '0';
  }

  return null;
}

function exampleMapKey(type: string): string {
  if (type === 'bool') {
    return 'false';
  }

  if (type === 'string') {
    return 'key';
  }

  return '0';
}

function normalizeDefaultValue(value: unknown): unknown {
  if (typeof value === 'function') {
    return undefined;
  }

  if (value instanceof Uint8Array) {
    return '';
  }

  return value;
}

function normalizeLookupName(name: string): string {
  return stripLeadingDot(name).toLowerCase();
}

function stripLeadingDot(value: string): string {
  return value.startsWith('.') ? value.slice(1) : value;
}

function joinPath(parent: string, child: string): string {
  return `${stripLeadingDot(parent)}.${child}`;
}

function lowerCamelCase(value: string): string {
  return value.replace(/_([a-zA-Z0-9])/g, (_, next: string) => next.toUpperCase());
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
