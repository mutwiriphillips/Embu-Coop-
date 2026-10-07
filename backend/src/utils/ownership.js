const { httpError } = require("./geography");

/**
 * A record named in the URL (a document, a committee, a member...) must belong
 * to the cooperative named in the same URL. requireCooperativeAccess only vouches
 * for the cooperative id; without this check a user could put their own
 * cooperative in the path and another county's record id after it.
 * Answers 404 either way, so ids in other counties can't be probed.
 */
function assertBelongs(record, cooperativeId, what) {
  if (!record || record.cooperativeId !== cooperativeId) throw httpError(404, `${what} not found in this cooperative`);
}

module.exports = { assertBelongs };
