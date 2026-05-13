import { generateClient } from "aws-amplify/api";

let _client = null;

export function getGraphqlClient() {
  if (!_client) _client = generateClient();
  return _client;
}
