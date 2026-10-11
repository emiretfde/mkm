import test from 'node:test';import assert from 'node:assert/strict';
import {certificateStatus,validateCertificateDates,canAccessCertificate} from '../src/certificates.js';
test('certificate states',()=>{assert.equal(certificateStatus('2026-10-01','2026-10-11'),'expired');assert.equal(certificateStatus('2026-11-01','2026-10-11'),'soon');assert.equal(certificateStatus('2027-01-01','2026-10-11'),'valid');});
test('rejects bad dates',()=>{assert.throws(()=>validateCertificateDates('2026-10-11','2026-10-01'));assert.throws(()=>validateCertificateDates('2026-02-30','2026-12-01'));});
test('requires valid dates',()=>{assert.doesNotThrow(()=>validateCertificateDates('2026-10-11','2027-10-11'));assert.throws(()=>validateCertificateDates('','2027-10-11'));});
test('coach only accesses own assigned group',()=>{const m={group_id:'A'};assert.equal(canAccessCertificate({role:'coach'},m,['A']),true);assert.equal(canAccessCertificate({role:'coach'},m,['B']),false);assert.equal(canAccessCertificate({role:'admin'},m,[]),true);});
