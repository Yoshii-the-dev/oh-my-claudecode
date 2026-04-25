/**
 * `omc learning migrate|project|validate` — typed JSON document helpers.
 */
import { colors } from '../utils/formatting.js';
import { migrateLearningMarkdownToJson, validateLearningDocument, writeLearningProjection, } from '../../product/learning-document.js';
export async function learningMigrateCommand(root, options, logger = console) {
    const report = migrateLearningMarkdownToJson(root, {
        write: options.write,
        force: options.force,
        cycleId: options.cycleId,
    });
    if (options.json) {
        logger.log(JSON.stringify(report, null, 2));
        return report.ok ? 0 : 1;
    }
    logger.log(colors.bold('Learning migrate (.omc/learning/current.md -> current.json)'));
    logger.log(`  source:    ${report.sourcePath}`);
    logger.log(`  target:    ${report.jsonPath}`);
    logger.log(`  wrote:     ${report.wrote}`);
    if (report.projectionPath) {
        logger.log(`  projection ${report.projectionPath}`);
    }
    for (const issue of report.issues) {
        const marker = issue.severity === 'error' ? colors.red('error') : colors.yellow('warning');
        logger.log(`  ${marker} ${issue.code}: ${issue.message}`);
    }
    logger.log('');
    logger.log(report.ok ? colors.green('Migration ok.') : colors.red('Migration failed.'));
    return report.ok ? 0 : 1;
}
export async function learningProjectCommand(root, options, logger = console) {
    try {
        const path = writeLearningProjection(root ?? process.cwd());
        if (options.json) {
            logger.log(JSON.stringify({ ok: true, path }, null, 2));
        }
        else {
            logger.log(colors.green(`Wrote projection: ${path}`));
        }
        return 0;
    }
    catch (error) {
        if (options.json) {
            logger.log(JSON.stringify({ ok: false, error: String(error) }, null, 2));
        }
        else {
            logger.log(colors.red(`Projection failed: ${error instanceof Error ? error.message : String(error)}`));
        }
        return 1;
    }
}
export async function learningValidateCommand(root, options, logger = console) {
    const report = validateLearningDocument(root);
    if (options.json) {
        logger.log(JSON.stringify(report, null, 2));
        return report.ok ? 0 : 1;
    }
    logger.log(colors.bold(`Learning document validation (${report.path})`));
    for (const issue of report.issues) {
        const marker = issue.severity === 'error' ? colors.red('error') : colors.yellow('warning');
        logger.log(`  ${marker} ${issue.code}: ${issue.message}`);
    }
    logger.log('');
    logger.log(report.ok ? colors.green('Document ok.') : colors.red('Document failed.'));
    return report.ok ? 0 : 1;
}
//# sourceMappingURL=learning-document.js.map