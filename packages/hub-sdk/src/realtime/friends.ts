import { HubSdkError } from '../errors';
import type { HubFriends } from './types';

/** REST friends (/v2/friend) are stretch work. Every call rejects with `not_implemented` until then. */
export function createFriendsStub(): HubFriends {
  const nope = () => Promise.reject(new HubSdkError('not_implemented', 'Friends are not available yet'));
  return { list: nope, add: nope, remove: nope, block: nope };
}
