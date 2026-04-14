async function test() { throw new Error('Unhandled Promise!'); }
test();
setInterval(() => console.log('alive'), 1000);
