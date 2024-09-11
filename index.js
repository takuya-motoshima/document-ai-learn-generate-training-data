const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const {program, Option} = require('commander');
const {globSync} = require('glob');
const seedrandom = require('seedrandom');

/**
 * Generate images of training data.
 * @param {'cashcard'|'driverslicense'|'driverslicense_backside'|'health_insurance_card'|'mynumber'} options.type Document type.
 * @param {string} options.output Training data image output directory.
 * @param {number} trainRatio Train ratio.
 * @return {Promise<void>}
 */
const generate = async (options, trainRatio = 0.8) => {
  // Load the base images.
  const pattern = `bases/${options.type}/*.{png,jpg}`;
  // const pattern = path.join(__dirname, `bases/${options.type}/*.{png,jpg}`);
  const baseFiles = globSync(pattern);
  if (baseFiles.length === 0)
    return void console.log(`Base image not found in ${pattern}.`);

  // Load background metadata.
  const backgroundMetas = JSON.parse(fs.readFileSync('background/background-meta.json', 'utf8'));
  for (let baseFile of baseFiles) {
    for (let [i, backgroundMeta] of Object.entries(backgroundMetas)) {
      // Output base images of various background patterns.
      const backgroundFile = path.join(__dirname, 'background', backgroundMeta.filename);

      // Output file name.
      const outputFileName = `${path.parse(baseFile).name}_${i}.jpg`;

      // Generate a unique number from the file name.
      const seed = Math.abs(seedrandom(outputFileName).int32());

      // The output files are divided into train and test in the ratio of 8:2.
      const subdir = (seed % 10 / 10 < trainRatio) ? 'train': 'test';

      // Output file path.
      const outputFile = path.join(__dirname, options.output, subdir, outputFileName);
      if (fs.existsSync(outputFile) && fs.statSync(baseFile).mtime <= fs.statSync(outputFile).mtime) {
        // The output file will be overwritten only if the base image is newer than the output file.
        console.log(`Skip ${path.relative(__dirname, outputFile)} because it already exists`);
        continue;
      }
      if (backgroundMeta.composite === 'center')
        // The base image is placed in the center.
        await centerImage(baseFile, backgroundFile, outputFile);
      else if (backgroundMeta.composite === 'embedded') {
        // Place the base image in the transparent area.
        // If the orientation (landscape or portrait) of the base image and the transparent area do not match, skip.
        const {width, height} = await (sharp(baseFile)).metadata();
        const baseOrientation = width > height ? 'landscape' : 'portrait';
        if (baseOrientation !== backgroundMeta.orientation)
          continue;
        await placeOnTransparent(baseFile, backgroundFile, outputFile, backgroundMeta.transparentBoundary);
      }
      console.log(`Generate ${path.relative(__dirname, outputFile)}`);
    }
  }
}

/**
 * The base image is placed in the center.
 * @param {string} baseFile Base Image Path.
 * @param {string} backgroundFile Background image file path.
 * @param {string} outputFile Output file path.
 * @return {Promise<void}
 */
const centerImage = async (baseFile, backgroundFile, outputFile) => {
  const backgroundInstance = sharp(backgroundFile);
  const baseInstance = sharp(baseFile);
  const baseMeta = await baseInstance.metadata();
  await backgroundInstance
    .resize(Math.floor(Math.max(baseMeta.width, baseMeta.height) * 1.2))
    .composite([{
      input: baseInstance.options.input.file,
      gravity: 'center',
    }])
    .toFile(outputFile);
}

/**
 * Place the base image in the transparent area.
 * @param {string} baseFile Base Image Path.
 * @param {string} backgroundFile Background image file path.
 * @param {string} outputFile Output file path.
 * @param {{left: number, top: number, width: number, height: number}} transparentBoundary Transparent area bounding box.
 * @return {Promise<void}
 */
const placeOnTransparent = async (baseFile, backgroundFile, outputFile, transparentBoundary) => {
  // Resize the overlay image with the aspect ratio of the transparent part of the background.
  const baseInstance = sharp(baseFile);
  let baseMeta = await baseInstance.metadata();
  baseMeta = (await baseInstance
    .resize({
      width: baseMeta.width,
      height: Math.floor(baseMeta.width * transparentBoundary.height / transparentBoundary.width),
      fit: sharp.fit.fill
    })
    .toBuffer({resolveWithObject: true})).info;

  // Resize the background image so that the overlay image fits the transparent area.
  const backgroundInstance = sharp(backgroundFile);
  let backgroundMeta = await backgroundInstance.metadata();
  const backgroundScale = baseMeta.width / (backgroundMeta.width * transparentBoundary.width);
  backgroundMeta = (await backgroundInstance
    .resize(Math.floor(backgroundMeta.width * backgroundScale), Math.floor(backgroundMeta.height * backgroundScale))
    .toBuffer({resolveWithObject: true})).info;
  backgroundInstance
    .composite([{
      input: await baseInstance.toBuffer(),
      top: Math.floor(transparentBoundary.top * backgroundMeta.height),
      left: Math.floor(transparentBoundary.left * backgroundMeta.width),
      blend: 'dest-over',
    }])
    .toFile(outputFile);
}

// Get Arguments.
const options = program
  .addOption(new Option('-t, --type <cashcard|driverslicense|driverslicense_backside|health_insurance_card|mynumber>', 'Document type.')
    .choices([
      'cashcard',
      'driverslicense',
      'driverslicense_backside',
      'health_insurance_card',
      'mynumber',
      'sample',
    ])
    .makeOptionMandatory())
  .requiredOption('-o, --output <string>', 'Training data image output directory.')
  .parse()
  .opts();

// If there is no output directory, create one.
for (let outputDir of [
  path.join(__dirname, options.output),
  path.join(__dirname, options.output, 'train'),
  path.join(__dirname, options.output, 'test'),
])
  if (!fs.existsSync(outputDir))
    fs.mkdirSync(outputDir, {recursive: true});

// Generate images of training data.
generate(options);