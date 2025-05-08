const { readdirSync } = require("fs");
const { exec } = require("child_process");

module.exports = {
  prerequisites: function () {
    return !!process.env.GITHUB_ACTIONS;
  },

  async execute(ShipRenderPath) {
    exec("npm install @actions/artifact").on("close", async () => {
      const { DefaultArtifactClient } = require("@actions/artifact");
      const artifactClient = new DefaultArtifactClient();
      const artifactName = `${process.env.GITHUB_RUN_ID}.zip`;

      const files = readdirSync(ShipRenderPath).map(
        (ship) => `${ShipRenderPath}/${ship}/${ship.toLowerCase()}.png`
      );

      try {
        const { id, size } = await artifactClient.uploadArtifact(
          artifactName,
          files,
          { retentionDays: 10 }
        );
        console.log(`Created artifact with id: ${id} (bytes: ${size})`);
      } catch (error) {
        console.error("Error uploading artifact:", error);
      }
    });
  },
};
