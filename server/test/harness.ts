/**
 * The one place the HTTP suites build the app (RFC #270, slice #271).
 *
 * `buildTestApp` returns the production app factory wired with offline seams:
 * a fresh pg-mem database with `migrate()` applied, an in-memory user directory,
 * a recording fake mailer, a recording fake auth admin, a fake session, and a
 * controllable clock. A suite overrides only the seams it cares about. Adding a
 * field to `AppDeps` means editing `app.ts`, `server.ts` and this file, never
 * the suites.
 *
 * The fake session: a request is authenticated iff it carries the `x-user-id`
 * header, and its email is `${id}@example.test`, so events carry both without a
 * real user. `as(userId)` returns a supertest agent that sends that header.
 */
import type { Express } from 'express';
import { newDb } from 'pg-mem';
import request from 'supertest';
import { createApp, type AppDeps } from '../src/app';
import { createContestRepo } from '../src/contestRepo';
import { migrate, type Pool } from '../src/db';
import { createEventLog } from '../src/eventLog';
import type { OutgoingMail } from '../src/mailer';
import { createQuestionnaireStore } from '../src/questionnaireStore';
import { createEmailTemplateStore } from '../src/emailTemplateStore';
import { createRateLimiter } from '../src/rateLimiter';
import { createInMemoryUserDirectory } from '../src/userDirectory';

/** Where every test clock starts unless a suite says otherwise. */
export const TEST_START = '2026-09-01T12:00:00.000Z';

/** The header the fake session reads. */
export const USER_HEADER = 'x-user-id';

export interface TestClock {
  /** The current test time. Only `advance` and `set` move it. */
  readonly now: Date;
  advance(ms: number): void;
  set(at: string | Date): void;
}

export interface TestAppOptions {
  /** Clock start (ISO); defaults to TEST_START. */
  start?: string;
  /**
   * Builds the questionnaire rate limiters with these limits per 1-second
   * window, timed by the test clock. Omitted: the production limits, also on
   * the test clock (via `AppDeps.now`).
   */
  limits?: { perIp: number; perEmail: number };
}

export interface TestApp {
  app: Express;
  /** The deps the app was built with (defaults merged with overrides). */
  deps: AppDeps;
  /** The pg-mem pool behind the default repos and event log. */
  pool: Pool;
  clock: TestClock;
  /** Every mail the fake mailer accepted, in order. */
  sentMail: OutgoingMail[];
  /** Set true to make the fake mailer throw (nothing is recorded). */
  mailFails: boolean;
  /** Every email the fake auth admin was asked to send a sign-in link to. */
  signInLinks: string[];
  /** A supertest agent authenticated as `userId` through the fake session. */
  as(userId: string): ReturnType<typeof request.agent>;
}

function createTestClock(start: string): TestClock {
  let ms = new Date(start).getTime();
  return {
    get now() {
      return new Date(ms);
    },
    advance(by) {
      ms += by;
    },
    set(at) {
      ms = new Date(at).getTime();
    },
  };
}

export async function buildTestApp(
  overrides: Partial<AppDeps> = {},
  options: TestAppOptions = {},
): Promise<TestApp> {
  const pool = new (newDb().adapters.createPg().Pool)() as unknown as Pool;
  await migrate(pool);

  const clock = createTestClock(options.start ?? TEST_START);
  const nowMs = () => clock.now.getTime();
  const sentMail: OutgoingMail[] = [];
  const signInLinks: string[] = [];

  const harness = {} as TestApp;

  const defaults: AppDeps = {
    repo: createContestRepo(pool),
    eventLog: createEventLog(pool),
    userDirectory: createInMemoryUserDirectory([]),
    authAdmin: {
      sendSignInLink: async (email) => {
        signInLinks.push(email);
      },
    },
    adminEmails: new Set(),
    resolveUser: (req) => {
      const id = req.header(USER_HEADER);
      return id ? { id, email: `${id}@example.test` } : null;
    },
    now: () => clock.now,
    questionnaireStore: createQuestionnaireStore(pool),
    emailTemplateStore: createEmailTemplateStore(pool),
    mailer: {
      send: async (mail) => {
        if (harness.mailFails) throw new Error('MailerSend is down');
        sentMail.push(mail);
      },
    },
    questionnaireLimiters: options.limits && {
      perIp: createRateLimiter({ limit: options.limits.perIp, windowMs: 1000, now: nowMs }),
      perEmail: createRateLimiter({ limit: options.limits.perEmail, windowMs: 1000, now: nowMs }),
    },
  };

  const deps: AppDeps = { ...defaults, ...overrides };
  const app = createApp(deps);

  Object.assign(harness, {
    app,
    deps,
    pool,
    clock,
    sentMail,
    mailFails: false,
    signInLinks,
    as: (userId: string) => request.agent(app).set(USER_HEADER, userId),
  });
  return harness;
}
