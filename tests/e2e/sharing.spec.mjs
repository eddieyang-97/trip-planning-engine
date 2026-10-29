import assert from 'node:assert/strict';
import {openDisclosure} from './navigation.mjs';
import {test, expect, privateNote, privateResearch, originalTitle, editedTitle, editedNotes} from './fixture.mjs';

test('built itinerary: lost edit acknowledgement, viewer privacy, revoke and deny', async ({browser, app}) => {
  const contextOptions = {viewport: {width: 390, height: 844}, serviceWorkers: 'block'};
  const organizer = await browser.newContext(contextOptions);
  const guest = await browser.newContext(contextOptions);
  const externalRequests = [], pageErrors = [];
  for (const context of [organizer, guest]) {
    await context.route('**/*', route => {
      if (new URL(route.request().url()).origin === app.origin) return route.continue();
      externalRequests.push(route.request().url());
      return route.abort('blockedbyclient');
    });
    context.on('page', page => page.on('pageerror', error => pageErrors.push(error.message)));
  }
  try {
    const owner = await organizer.newPage(), viewer = await guest.newPage();
    async function signIn(page, token) {
      expect(page.viewportSize()).toEqual({width: 390, height: 844});
      await page.goto(`${app.origin}/itinerary?trip=${app.tripId}&view=details`);
      await page.getByLabel('Local development token').fill(token);
      await page.getByRole('button', {name: 'Open local trips', exact: true}).click();
      await expect(page.locator('#trip-title')).toHaveText('Sharing browser fixture — fictional');
      await expect(page.locator(`#item-${app.itemId}`)).toBeVisible();
    }
    const persisted = async () => ({
      trip: (await app.db.query('select itinerary_revision from trips where id=$1', [app.tripId])).rows[0],
      items: (await app.db.query('select * from itinerary_items where trip_id=$1', [app.tripId])).rows,
      events: (await app.db.query('select * from itinerary_events where trip_id=$1 order by revision', [app.tripId])).rows,
      edits: (await app.db.query("select * from mutation_requests where trip_id=$1 and operation='update_itinerary_item'", [app.tripId])).rows,
    });
    const stayList=owner.waitForResponse(r=>r.url().endsWith('/itinerary-api/list_stay_decisions'));
    const diningList=owner.waitForResponse(r=>r.url().endsWith('/itinerary-api/list_dining_decisions'));
    await signIn(owner, app.ownerToken);
    expect((await stayList).ok()).toBeTruthy();expect((await diningList).ok()).toBeTruthy();
    await expect(owner.locator('#stay-research')).toBeHidden();
    await expect(owner.locator('#dining-research')).toBeHidden();
    await openDisclosure(owner,'research-panel');
    await owner.locator('#add-research summary').click();
    await owner.getByRole('button',{name:'Accommodation',exact:true}).click();
    const stayDialog=owner.locator('#stay-decision-dialog');
    await stayDialog.getByLabel('Comparison title',{exact:true}).fill('Fictional accommodation');
    await stayDialog.getByRole('button',{name:'Create lodging comparison',exact:true}).click();
    await expect(stayDialog).not.toBeVisible();
    await expect(owner.locator('#stay-research summary').first()).toContainText('Fictional accommodation · 0 options · 0 shortlisted');
    await expect(owner.locator('#dining-research')).toBeHidden();
    await owner.locator('#add-research summary').click();
    await owner.getByRole('button',{name:'Dining',exact:true}).click();
    const diningDialog=owner.locator('#dining-decision-dialog');
    await diningDialog.getByLabel('Comparison title',{exact:true}).fill('Fictional dinner');
    await diningDialog.getByRole('button',{name:'Create dining comparison',exact:true}).click();
    await expect(diningDialog).not.toBeVisible();
    await expect(owner.locator('#dining-research summary').first()).toContainText('Fictional dinner · 0 options · 0 shortlisted');
    await signIn(viewer, app.viewerToken);
    await expect(viewer.locator('#add-research')).toBeHidden();
    await expect(viewer.locator('#stay-research')).toBeHidden();
    await expect(viewer.locator('#dining-research')).toBeHidden();
    const card = owner.locator(`#item-${app.itemId}`);
    await expect(card).toContainText(privateNote);
    await expect(owner.locator('#research')).toContainText(privateResearch);
    await card.getByRole('button', {name: 'Edit', exact: true}).click();
    const dialog = owner.locator('#item-dialog');
    await dialog.getByLabel('Title', {exact: true}).fill(editedTitle);
    await dialog.getByLabel('Practical notes', {exact: false}).fill(editedNotes);

    // Deterministic failure: the actual backend commits, but the browser loses
    // its acknowledgement. No stubbed success or mocked domain mutation.
    const attempts = [];
    await owner.route('**/itinerary-api/update_itinerary_item', async route => {
      attempts.push(route.request().postDataJSON());
      if (attempts.length === 1) {
        const committed = await route.fetch({maxRetries: 0});
        expect(committed.status()).toBe(200);
        await committed.dispose();
        await route.abort('failed');
      } else {
        await route.continue();
      }
    });
    await dialog.getByRole('button', {name: 'Save to itinerary', exact: true}).click();
    await expect(dialog.locator('#item-error')).toContainText('Refresh to check saved changes');
    const afterLostAck = await persisted();
    expect(afterLostAck.trip.itinerary_revision).toBe(3);
    expect(afterLostAck.events).toHaveLength(2);
    expect(afterLostAck.edits).toHaveLength(1);
    expect(afterLostAck.items[0].payload.title).toBe(editedTitle);

    await dialog.getByRole('button', {name: 'Save to itinerary', exact: true}).click();
    await expect(dialog).not.toBeVisible();
    await expect(card).toContainText(editedTitle);
    await expect(card).toContainText(editedNotes);
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toEqual(attempts[0]); // includes revision and idempotency key
    const afterRetry = await persisted();
    assert.deepEqual(afterRetry, afterLostAck, 'retry must not mutate rows/history/timestamps again');
    expect(afterRetry.items).toHaveLength(1);
    expect(afterRetry.items[0].id).toBe(app.itemId);
    expect(afterRetry.items[0].payload.bookingNote).toBe(privateNote);
    expect(afterRetry.items[0].payload.status).toBe('user_reported_booked');
    const event = afterRetry.events[1];
    expect(event).toMatchObject({action: 'edited', actor_id: app.owner, item_id: app.itemId, revision: 3});
    expect(event.before_payload.payload.title).toBe(originalTitle);
    expect(event.after_payload.payload.title).toBe(editedTitle);
    await expect(owner.locator('#history')).toContainText(`Edited: ${editedTitle}`);

    const viewResponse = viewer.waitForResponse(r => r.url().endsWith('/itinerary-api/get_itinerary'));
    await openDisclosure(viewer,'plan-more');
    await viewer.getByRole('button', {name: 'Refresh', exact: true}).click();
    const projection = await (await viewResponse).json();
    expect(projection.role).toBe('viewer');
    expect(projection.revision).toBe(3);
    expect(projection.history).toEqual([]);
    expect(projection.research.decisions).toEqual([]);
    expect(projection.trip.owner_id).toBeUndefined();
    expect(projection.items[0].payload.bookingNote).toBe('');
    expect(JSON.stringify(projection)).not.toContain(privateNote);
    expect(JSON.stringify(projection)).not.toContain(privateResearch);
    await expect(viewer.locator(`#item-${app.itemId}`)).toContainText(editedNotes);
    await expect(viewer.locator('#timeline')).toContainText(editedTitle);
    await expect(viewer.locator('#timeline')).toContainText('Booked · reported by owner');
    await expect(viewer.locator('body')).not.toContainText(privateNote);
    await expect(viewer.locator('body')).not.toContainText(privateResearch);
    await expect(viewer.getByRole('button', {name: 'Edit', exact: true})).toHaveCount(0);
    await expect(viewer.locator('#add-item')).toBeHidden();
    await expect(viewer.locator('#share-trip')).toBeHidden();
    await expect(viewer.locator('#history-section')).toBeHidden();

    await owner.getByRole('button', {name: 'Share trip', exact: true}).click();
    const sharing = owner.locator('#share-dialog');
    await expect(sharing.locator('#access-list')).toContainText('Fixture viewer');
    const revokeResponse = owner.waitForResponse(r => r.url().endsWith('/itinerary-api/revoke_itinerary_access'));
    await sharing.getByRole('button', {name: 'Revoke collaborator access', exact: true}).click();
    expect((await revokeResponse).status()).toBe(200);
    await expect(sharing.locator('#access-list')).toContainText('Revoked');

    const deniedResponse = viewer.waitForResponse(r => r.url().endsWith('/itinerary-api/get_itinerary'));
    await openDisclosure(viewer,'plan-more');
    await viewer.getByRole('button', {name: 'Refresh', exact: true}).click();
    const denied = await deniedResponse;
    expect(denied.status()).toBe(404);
    expect(denied.headers()['cache-control']).toBe('no-store');
    expect((await denied.json()).code).toBe('FORBIDDEN_OR_NOT_FOUND');
    await expect(viewer.locator('#trip-view')).toBeHidden();
    await expect(viewer.locator('#timeline')).toBeEmpty();
    await expect(viewer.locator('#trip-list')).not.toContainText('Sharing browser fixture');
    await expect(viewer.locator('body')).not.toContainText(editedNotes);
    await expect(viewer.locator('body')).not.toContainText(privateNote);

    const invites = (await app.db.query('select revoked_at from itinerary_invites where id=$1', [app.inviteId])).rows;
    const members = (await app.db.query('select revoked_at from itinerary_members where invite_id=$1', [app.inviteId])).rows;
    expect(invites).toHaveLength(1); expect(invites[0].revoked_at).not.toBeNull();
    expect(members).toHaveLength(1); expect(members[0].revoked_at).not.toBeNull();
    const revokes = (await app.db.query("select * from mutation_requests where trip_id=$1 and operation='revoke_itinerary_access'", [app.tripId])).rows;
    expect(revokes).toHaveLength(1);
    assert.deepEqual(await persisted(), afterRetry, 'read/revoke/deny must preserve item, history and edit count');
    expect((await app.db.query('select * from search_runs')).rows).toHaveLength(0);
    expect(externalRequests).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await organizer.close();
    await guest.close();
  }
});
