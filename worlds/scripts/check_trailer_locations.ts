// Fast geometry audit before spending time rendering any release media.
import { checkTrailerLocations } from '../src/trailer/audit';
import { createTrailerCourse } from '../src/trailer/staging';
import { rsHouse } from '../src/ratseek_house';

export { checkTrailerLocations } from '../src/trailer/audit';

const report = checkTrailerLocations();
console.log('Capture seed:', report.seed, createTrailerCourse().course.variant.pieces);
console.log('Manor cheese locations:', rsHouse().cheese.slice(0, 4));
console.log(`Audited ${report.frames} frames: ${report.failures.length} failures, ${report.observations.length} observations.`);
for (const issue of report.observations.filter(i => i.check === 'brief-subject-occlusion')) console.log(issue);
for (const issue of report.failures) console.error(issue);
if (report.failures.length) throw new Error(`${report.failures.length} actual trailer geometry checks failed.`);
