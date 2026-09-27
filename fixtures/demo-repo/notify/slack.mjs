// The only thing in this fixture that pushes rather than records.
export async function announce(lead) {
  await fetch('https://hooks.slack.com/services/T000/B000/invented', {
    method: 'POST',
    body: JSON.stringify({ text: `lead ${lead.id}` }),
  });
}
