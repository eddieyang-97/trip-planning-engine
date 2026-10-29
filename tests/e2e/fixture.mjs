import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {test as base, expect} from '@playwright/test';
// Import the compiled backend, not a parallel implementation or mock HTTP API.
import {embedded, migrate} from '../../dist/src/database.js';
import {Core} from '../../dist/src/core.js';
import {flaineCriteria} from '../../dist/src/acceptance.js';
import {createApp} from '../../dist/src/app.js';
import {itineraryRoutes} from '../../dist/src/itinerary-web.js';

export const privateNote = 'PRIVATE-FIXTURE-ONLY booking evidence';
export const privateResearch = 'PRIVATE-FIXTURE-ONLY research reasoning';
export const originalTitle = 'Fictional mountain stay';
export const editedTitle = 'Fictional mountain stay — arrival updated';
export const editedNotes = 'Meet at reception at 18:00.';

export const test = base.extend({
  app: async ({}, use) => {
    // No environment DB URL, disk path, Supabase, worker or provider is consulted.
    const db = await embedded();
    const http = createServer();
    try {
      await migrate(db);
      const core = new Core(db, false, false);
      const owner = randomUUID(), viewer = randomUUID();
      const ownerToken = randomUUID(), viewerToken = randomUUID();
      const authenticate = async header => {
        if (header === `Bearer ${ownerToken}`) return {userId: owner};
        if (header === `Bearer ${viewerToken}`) return {userId: viewer};
        throw Error('Unknown isolated fixture identity');
      };
      const call = (operation, args, user = owner) =>
        core.callFromWeb(operation, {...args, idempotencyKey: randomUUID()}, user);
      const {tripId} = await call('create_trip', {
        name: 'Sharing browser fixture — fictional', destination: 'Fictional mountain resort',
        startDate: '2027-01-01', endDate: '2027-01-02', adults: 2,
      });
      const {itemId} = await call('add_itinerary_item', {
        tripId, expectedRevision: 1,
        item: {
          type: 'accommodation', title: originalTitle,
          startDate: '2027-01-01', endDate: '2027-01-02',
          startTime: null, endTime: null, timeZone: null, endTimeZone: null,
          location: 'Fictional resort reception', url: null, mapLocations: [],
          notes: 'Arrival time to confirm.', openQuestion: '',
          status: 'user_reported_booked', bookingNote: privateNote,
        },
      });
      await db.query('insert into client_grants(owner_id,client_id,permissions) values($1,$2,$3)',
        [owner, 'fixture-seed-only', ['read', 'write']]);
      await core.call('create_decision', {tripId, title: privateResearch, idempotencyKey: randomUUID(), criteria: {
        ...flaineCriteria, outbound: '2027-01-01', inbound: '2027-01-02', adults: 2,
      }}, {userId: owner, clientId: 'fixture-seed-only'});
      const {inviteId, token} = await call('create_itinerary_invite', {
        tripId, label: 'Fixture viewer', role: 'viewer',
      });
      await call('accept_itinerary_invite', {token, displayName: 'Fixture viewer'}, viewer);
      await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
      const origin = `http://127.0.0.1:${http.address().port}`;
      http.on('request', createApp({
        core, publicOrigin: origin,
        authenticate: async () => {throw Error('MCP disabled in this fixture');},
        itinerary: itineraryRoutes({core, origin, local: true, authenticate}),
      }));
      // A fixed-origin deny rule catches accidental maps/auth/provider traffic.
      // Every allowed browser request still reaches the real local HTTP server.
      await use({db, origin, tripId, itemId, inviteId, owner, viewer, ownerToken, viewerToken});
    } finally {
      http.closeAllConnections();
      await new Promise(resolve => http.close(resolve));
      await db.close();
    }
  },
});

export {expect};
