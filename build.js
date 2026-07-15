const fs = require("fs-extra");
const path = require("path");
const { execSync } = require("child_process");

const srcDir = path.join(__dirname, "src");
const distDir = path.join(__dirname, "dist");
const publicDir = path.join(__dirname, "public");

fs.removeSync(distDir);
fs.ensureDirSync(distDir);
fs.ensureDirSync(path.join(distDir, "css"));
fs.ensureDirSync(path.join(distDir, "js"));
fs.ensureDirSync(path.join(distDir, "icons"));

fs.copySync(
  path.join(__dirname, "manifest.json"),
  path.join(distDir, "manifest.json")
);
fs.copySync(
  path.join(__dirname, "popup.html"),
  path.join(distDir, "popup.html")
);
fs.copySync(
  path.join(__dirname, "quiz.html"),
  path.join(distDir, "quiz.html")
);
fs.copySync(path.join(srcDir, "js"), path.join(distDir, "js"));
fs.copySync(path.join(srcDir, "css"), path.join(distDir, "css"));

function processIcons() {
  console.log("Processing icons...");

  fs.ensureDirSync(path.join(distDir, "icons"));

  const iconTypes = ["on", "off"];
  const iconSizes = [16, 48, 128];

  iconTypes.forEach((iconType) => {
    const srcIcon = path.join(srcDir, "icons", `${iconType}.png`);

    if (!fs.existsSync(srcIcon)) {
      console.error(`Source icon not found: ${srcIcon}`);
      return;
    }

    const destIcon = path.join(distDir, "icons", `${iconType}.png`);
    fs.copySync(srcIcon, destIcon);
    console.log(`Copied icon: ${destIcon}`);

    iconSizes.forEach((size) => {
      if (iconType === "off") {
        const sizedIcon = path.join(distDir, "icons", `icon${size}.png`);
        fs.copySync(srcIcon, sizedIcon);
        console.log(`Created icon: ${sizedIcon}`);
      }
    });
  });
}

processIcons();

if (fs.existsSync(publicDir)) {
  fs.copySync(publicDir, distDir);
}

console.log("Build completed successfully!");

if (process.argv.includes("--zip")) {
  try {
    const archiver = require("archiver");
    const output = fs.createWriteStream(
      path.join(__dirname, "literategoggles.zip")
    );
    const archive = archiver("zip", {
      zlib: { level: 9 },
    });

    output.on("close", () => {
      console.log(`ZIP archive created: ${archive.pointer()} total bytes`);
    });

    archive.on("error", (err) => {
      throw err;
    });

    archive.pipe(output);
    archive.directory(distDir, false);
    archive.finalize();
  } catch (err) {
    console.error("Error creating ZIP:", err);
  }
}

if (process.argv.includes("--watch")) {
  const chokidar = require("chokidar");
  console.log("Watching for changes...");

  function rebuildFile(filePath) {
    console.log(`File changed: ${filePath}`);
    const relativePath = path.relative(__dirname, filePath);

    if (filePath.includes("src/js")) {
      const fileName = path.basename(filePath);
      const destPath = path.join(distDir, "js", fileName);
      fs.copySync(filePath, destPath);
      console.log(`Updated: ${destPath}`);
    } else if (filePath.includes("src/css")) {
      const fileName = path.basename(filePath);
      const destPath = path.join(distDir, "css", fileName);
      fs.copySync(filePath, destPath);
      console.log(`Updated: ${destPath}`);
    } else if (filePath.includes("src/icons")) {
      processIcons();
    } else if (filePath === path.join(__dirname, "manifest.json")) {
      fs.copySync(filePath, path.join(distDir, "manifest.json"));
      console.log(`Updated: manifest.json`);
    } else if (filePath === path.join(__dirname, "popup.html")) {
      fs.copySync(filePath, path.join(distDir, "popup.html"));
      console.log(`Updated: popup.html`);
    } else if (filePath === path.join(__dirname, "quiz.html")) {
      fs.copySync(filePath, path.join(distDir, "quiz.html"));
      console.log(`Updated: quiz.html`);
    }
  }

  const watcher = chokidar.watch(
    [
      path.join(srcDir, "**/*"),
      path.join(__dirname, "manifest.json"),
      path.join(__dirname, "popup.html"),
      path.join(__dirname, "quiz.html"),
    ],
    {
      persistent: true,
    }
  );

  watcher.on("change", rebuildFile).on("add", rebuildFile);
}
