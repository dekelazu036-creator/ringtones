// Lets Node load the Deno entry points in tests: maps the npm: specifier to a recording fake.
import { register } from 'node:module';
register('./hooks.mjs', import.meta.url);
