// Platform consumes its durable outbox; maxAttempts=3 and deadLetter=true are already configured.
export const deliveryPolicy = {maxAttempts: 3, deadLetter: true, timeout: 100};
export async function deliver(emailSDK, body) { return emailSDK.send(body); }
