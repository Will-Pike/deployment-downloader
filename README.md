# Deployment Downloader

A Node.js script for downloading media files listed in a deployment JSON, validating their properties (such as video/audio streams and image resolution), and generating validation reports in both JSON and CSV formats.

## Features

- Downloads media files (video and images) from URLs specified in a deployment JSON.
- Validates video files for bitrate, aspect ratio, and stream presence.
- Validates image files for resolution and size.
- Generates a summary report in JSON and CSV formats for easy review.
- CSV report separates file number, UUID, issue type, and issue details for analysis.

## Requirements

- [Node.js](https://nodejs.org/) (v16+ recommended)
- [ffmpeg/ffprobe](https://ffmpeg.org/download.html) installed and available in your system PATH
- [sharp](https://www.npmjs.com/package/sharp) library (install with `npm install sharp`)

## Setup

1. Clone the repository:
   ```
   git clone https://github.com/Will-Pike/deployment-downloader.git
   cd deployment-downloader
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Download a deployment JSON file from S3 (S3 > Buckets > cdn.snap.menu > {UUID of business for deployment} > most recent deployment) then save it as `deployment.json` in the project directory.

## Usage

Run the script from the terminal:
```
node deployment-downloader.js
```

After running, you will find:
- `validation-report.json` — detailed validation results
- `validation-report.csv` — easy-to-analyze CSV report

## Configuration

Edit `.gitignore` to exclude generated files and sensitive data from your repository.

## License

MIT License

## Author