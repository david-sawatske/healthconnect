import { a, defineData, type ClientSchema } from '@aws-amplify/backend';

const schema = a.schema({});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: { defaultAuthorizationMode: 'userPool' },
});
