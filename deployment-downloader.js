// deployment-downloader.js

const fs = require("fs");
const path = require("path");
const https = require("https");
const { execFile } = require("child_process");
const sharp = require("sharp");

const deploymentFile = "deployment.json";
const mediaBaseUrl = "https://cdn.signjet.com/media/";
const outputDir = "downloads";
const reportFile = "validation-report.json";

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir);
}

function getExtensionFromMime(mime) {
  const map = {
    "video/mp4": "mp4",
    "video/webm": "webm",
    "image/png": "png",
    "image/jpeg": "jpg",
  };
  return map[mime] || "bin";
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        return reject(new Error(`Failed to get '${url}' (${response.statusCode})`));
      }
      response.pipe(file);
      file.on("finish", () => {
        file.close(() => resolve(dest));
      });
    }).on("error", (err) => {
      fs.unlink(dest, () => reject(err));
    });
  });
}

function runFfprobe(filePath) {
  return new Promise((resolve, reject) => {
    execFile("ffprobe", [
      "-v", "error",
      "-print_format", "json",
      "-show_streams",
      "-show_format",
      filePath
    ], (err, stdout, stderr) => {
      if (err) {
        return reject(err);
      }
      try {
        const data = JSON.parse(stdout);
        resolve(data);
      } catch (parseError) {
        reject(parseError);
      }
    });
  });
}

async function checkImageIssues(filepath) {
  const issues = [];
  try {
    const image = sharp(filepath);
    const metadata = await image.metadata();
    const { width, height, format } = metadata;

    if (!width || !height) {
      issues.push("Could not determine image resolution");
    } else {
      console.log(`✅ ${path.basename(filepath)} - Format: ${format}, Resolution: ${width}x${height}`);
      if (width >= 3000 || height >= 3000) {
        issues.push(`Image is very large (${width}x${height})`);
      }
    }
  } catch (err) {
    issues.push("Image validation error: " + err.message);
  }
  return issues;
}

function checkVideoIssues(filePath, data) {
  const issues = [];
  const videoStream = data.streams.find(s => s.codec_type === "video");
  const audioStream = data.streams.find(s => s.codec_type === "audio");
  const format = data.format || {};

  if (!videoStream) {
    issues.push("No video stream found");
    return issues;
  }

  const codec = videoStream.codec_name;
  const width = videoStream.width;
  const height = videoStream.height;
  const sar = videoStream.sample_aspect_ratio;
  const bitrate = parseFloat(videoStream.bit_rate || format.bit_rate || 0) / 1000; // kbps
  const duration = parseFloat(format.duration || videoStream.duration || 0);
  const aspectRatio = width / height;

  if (bitrate < 500) {
    issues.push(`Low bitrate: ${bitrate.toFixed(1)} kbps`);
  }

  // if (!audioStream) {
  //   issues.push("Missing audio stream");
  // }

  if (sar && sar !== "1:1") {
    issues.push(`Non-square pixels (SAR: ${sar})`);
  }

  if (["hevc", "vp9"].includes(codec)) {
    issues.push(`Incompatible codec: ${codec}`);
  }

  if (aspectRatio < 1.6 || aspectRatio > 1.8) {
    issues.push(`Non-16:9 aspect ratio (${width}x${height}, ${aspectRatio.toFixed(2)})`);
  }

  return issues;
}

const rawData = fs.readFileSync(deploymentFile);
const json = JSON.parse(rawData);

let mediaFiles = [];

(json.presentations || []).forEach((presentation, pIndex) => {
  console.log(`Scanning presentation ${pIndex + 1} with ${presentation.slides.length} slide(s)...`);

  (presentation.slides || []).forEach((slide, sIndex) => {
    console.log(` Slide ${sIndex + 1}:`);
    const elements = slide.elements || [];
    console.log(`Checking ${elements.length} element(s)...`);

    elements.forEach((el, eIndex) => {
      if (el.type === "media" && el.media && el.media.token) {
        mediaFiles.push({ token: el.media.token, mime: el.media.mime });
        console.log(`  -> Found media token: ${el.media.token}`);
      } else if (el.type === "container" && el.container && Array.isArray(el.container.medias)) {
        el.container.medias.forEach((media) => {
          if (media.token && media.mime) {
            mediaFiles.push({ token: media.token, mime: media.mime });
            console.log(`  -> Found container media token: ${media.token}`);
          }
        });
      }
    });
  });
});

console.log("\nFound media files:\n");
console.log(JSON.stringify(mediaFiles, null, 2));

(async () => {
  const problems = [];
  let totalFiles = 0;

  for (let i = 0; i < mediaFiles.length; i++) {
    const { token, mime } = mediaFiles[i];
    const ext = getExtensionFromMime(mime);
    const filename = `${i + 1}_${token}.${ext}`;
    const filepath = path.join(outputDir, filename);

    console.log(`\n⬇️ Downloading ${filename}...`);
    try {
      await downloadFile(mediaBaseUrl + token, filepath);

      if (mime.startsWith("video/")) {
        totalFiles++;
        const data = await runFfprobe(filepath);
        const issues = checkVideoIssues(filepath, data);

        if (issues.length > 0) {
          problems.push({ filename, issues });
          console.log(`❌ ${filename} has issues:`);
          issues.forEach(issue => console.log(` ⚠️ - ${issue}`));
        } else {
          const video = data.streams.find(s => s.codec_type === "video");
          const codec = video.codec_name;
          const width = video.width;
          const height = video.height;
          const bitrate = parseFloat(video.bit_rate || data.format.bit_rate || 0) / 1000;
          const duration = parseFloat(data.format.duration || video.duration || 0);

          console.log(`✅ ${filename} - Codec: ${codec}, Resolution: ${width}x${height}, Bitrate: ${bitrate.toFixed(1)} kbps, Duration: ${duration.toFixed(2)}s`);
        }
      } else if (mime.startsWith("image/")) {
        const issues = await checkImageIssues(filepath);
        if (issues.length > 0) {
          problems.push({ filename, issues });
          console.log(`❌ ${filename} has issues:`);
          issues.forEach(issue => console.log(` ⚠️ - ${issue}`));
        } else {
          console.log(`✅ ${filename} passed image checks.`);
        }
      } else {
        console.log(`ℹ️ ${filename} is not a video or image. Skipping checks.`);
      }
    } catch (err) {
      problems.push({ filename, issues: ["Validation error: " + err.message] });
      console.error(`❌ Validation error on ${filename}:`, err.message);
    }
  }

  console.log("\n📋 Summary Report:");
  console.log(`Total video files checked: ${totalFiles}`);
  if (problems.length === 0) {
    console.log("✅ All files passed validation.");
  } else {
    console.log(`❌ ${problems.length} file(s) with issues:`);
    problems.forEach(p => {
      console.log(`- ${p.filename}`);
      p.issues.forEach(issue => console.log(`   • ${issue}`));
    });
  }

  fs.writeFileSync(reportFile, JSON.stringify({ totalFiles, problems }, null, 2));
  console.log(`\n📄 Report written to ${reportFile}`);

  // After you write validation-report.json, add this:
  const csvPath = path.join(__dirname, 'validation-report.csv');
  const rows = ['number,uuid,issue_type,issue_details'];

  problems.forEach(item => {
    // Extract number and UUID from filename
    let number = '';
    let uuid = '';
    if (item.filename) {
      const match = item.filename.match(/^(\d+)_([^.]+)\./);
      if (match) {
        number = match[1];
        uuid = match[2];
      }
    }

    // Split issues
    (item.issues || []).forEach(issue => {
      let issueType = issue;
      let issueDetails = '';
      const parenMatch = issue.match(/^([^(]+)\s*\(([^)]+)\)/);
      if (parenMatch) {
        issueType = parenMatch[1].trim();
        issueDetails = parenMatch[2].trim();
      }
      rows.push(`"${number}","${uuid}","${issueType.replace(/"/g, '""')}","${issueDetails.replace(/"/g, '""')}"`);
    });

    // If no issues, still output the file info
    if ((item.issues || []).length === 0) {
      rows.push(`"${number}","${uuid}","",""`);
    }
  });

  fs.writeFileSync(csvPath, rows.join('\n'), 'utf8');
  console.log(`CSV written to ${csvPath}`);
})();
