import { createTask, transitionTo } from '../lib/tasks';
import { Context } from '../types';
import noAncestorBuild from '../ui/messages/warnings/noAncestorBuild';
import { initial, pending, success } from '../ui/tasks/initialize';

const AnnounceBuildMutation = `
  mutation AnnounceBuildMutation($input: AnnounceBuildInput!) {
    announceBuild(input: $input) {
      id
      number
      status
      autoAcceptChanges
      reportToken
    }
  }
`;

interface AnnounceBuildMutationResult {
  announceBuild: Context['announcedBuild'];
}

export const setEnvironment = async (ctx: Context) => {
  // We send up all environment variables provided by these complicated systems.
  // We don't want to send up *all* environment vars as they could include sensitive information
  // about the user's build environment
  ctx.environment = JSON.stringify(
    Object.entries(process.env).reduce((acc, [key, value]) => {
      if (ctx.env.ENVIRONMENT_WHITELIST.find((regex) => key.match(regex))) {
        acc[key] = value;
      }
      return acc;
    }, {})
  );

  ctx.log.debug(`Got environment ${ctx.environment}`);
};

export const announceBuild = async (ctx: Context) => {
  const { patchBaseRef, patchHeadRef, preserveMissingSpecs } = ctx.options;
  const { version, matchesBranch, changedFiles, ...commitInfo } = ctx.git; // omit some fields
  const { rebuildForBuildId, turboSnap } = ctx;
  const autoAcceptChanges = matchesBranch(ctx.options.autoAcceptChanges);

  const { announceBuild: announcedBuild } = await ctx.client.runQuery<AnnounceBuildMutationResult>(
    AnnounceBuildMutation,
    {
      input: {
        autoAcceptChanges,
        patchBaseRef,
        patchHeadRef,
        preserveMissingSpecs,
        ...commitInfo,
        ciVariables: ctx.environment,
        packageVersion: ctx.pkg.version,
        rebuildForBuildId,
        storybookAddons: ctx.storybook.addons,
        storybookVersion: ctx.storybook.version,
        storybookViewLayer: ctx.storybook.viewLayer,
        // GraphQL does not support union input types (yet), so we stringify the bailReason
        // @see https://github.com/graphql/graphql-spec/issues/488
        ...(turboSnap &&
          turboSnap.bailReason && { turboSnapBailReason: JSON.stringify(turboSnap.bailReason) }),
      },
    },
    { retries: 3 }
  );

  ctx.announcedBuild = announcedBuild;
  ctx.isOnboarding =
    announcedBuild.number === 1 || (announcedBuild.autoAcceptChanges && !autoAcceptChanges);

  if (!ctx.isOnboarding && !ctx.git.parentCommits) {
    ctx.log.warn(noAncestorBuild(ctx));
  }
};

export default createTask({
  title: initial.title,
  skip: (ctx: Context) => ctx.skip,
  steps: [transitionTo(pending), setEnvironment, announceBuild, transitionTo(success, true)],
});