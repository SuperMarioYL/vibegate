// a test file — its console.log must NOT be flagged as a "production path" smell.
// (regression guard for the SCAN_IGNORE test/spec glob exclusion.)
console.log('this console.log lives in a test file and should be ignored');
