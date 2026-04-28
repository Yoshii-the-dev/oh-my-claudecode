/**
 * stack-provision network-client.
 *
 * The motivating regression: skills.sh discovery was tripping its 30 rpm limit
 * (`HTTP 429: rate_limit_exceeded`) and the discovery code had no retry, no
 * shared rate-limit, no cache, no concurrency cap, and no API-key injection.
 * `network-client.mjs` is the single chokepoint that fixes all five at once;
 * these tests pin the contract.
 */
export {};
//# sourceMappingURL=stack-provision-network-client.test.d.ts.map