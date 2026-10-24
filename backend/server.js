import express from 'express';
import cors from 'cors';
import multer from 'multer';
import sharp from 'sharp';
import heicConvert from 'heic-convert';
import { AutoModel, AutoProcessor, RawImage, env } from '@huggingface/transformers';
import archiver from 'archiver';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import os from 'os';

const app = express();
const PORT = 4001; // 厳守制約: 4001ポート

app.use(
	cors({
		exposedHeaders: ['Content-Disposition'],
	}),
);
app.use(express.json());

env.cacheDir = path.join(os.homedir(), '.cache', 'huggingface', 'hub');

// BiRefNet モデルシングルトン
let birefnetModel = null;
let birefnetProcessor = null;
let isModelLoading = false;

async function loadBiRefNetModel() {
	if (birefnetModel && birefnetProcessor) {
		return { model: birefnetModel, processor: birefnetProcessor };
	}
	if (isModelLoading) {
		while (isModelLoading) {
			await new Promise((resolve) => setTimeout(resolve, 200));
		}
		return { model: birefnetModel, processor: birefnetProcessor };
	}

	isModelLoading = true;
	console.log('BiRefNet モデルをロードしています...');
	const modelId = 'onnx-community/BiRefNet_lite-ONNX';
	birefnetProcessor = await AutoProcessor.from_pretrained(modelId);
	birefnetModel = await AutoModel.from_pretrained(modelId);
	isModelLoading = false;
	console.log('BiRefNet モデルのロードが完了しました。');

	return { model: birefnetModel, processor: birefnetProcessor };
}

const storage = multer.diskStorage({
	destination: (req, file, cb) => {
		if (!req.tempDir) {
			req.tempDir = path.join(os.tmpdir(), `img-conv-${uuidv4()}`);
			fs.mkdirSync(req.tempDir, { recursive: true });
		}
		cb(null, req.tempDir);
	},
	filename: (req, file, cb) => {
		const ext = path.extname(file.originalname);
		const uniqueName = `${uuidv4()}${ext}`;
		cb(null, uniqueName);
	},
});

const upload = multer({
	storage,
	limits: { fileSize: 50 * 1024 * 1024 },
});

async function getUnifiedBuffer(filePath, originalname) {
	const fileBuf = await fs.promises.readFile(filePath);
	const ext = path.extname(originalname).toLowerCase();
	const isHeic =
		ext === '.heic' ||
		ext === '.heif' ||
		(fileBuf.length > 12 && fileBuf.toString('ascii', 4, 12).includes('ftyp'));

	if (isHeic) {
		const converted = await heicConvert({
			buffer: fileBuf,
			format: 'PNG',
		});
		return Buffer.from(converted);
	}
	return fileBuf;
}

function registerCleanup(res, tempDir) {
	let cleaned = false;
	const cleanup = async () => {
		if (cleaned || !tempDir) return;
		cleaned = true;
		try {
			if (fs.existsSync(tempDir)) {
				await fs.promises.rm(tempDir, { recursive: true, force: true });
			}
		} catch (err) {
			console.error('一時ファイルクリーンアップエラー:', err);
		}
	};
	res.on('finish', cleanup);
	res.on('close', cleanup);
}

// -------------------------------------------------------------
// ①〜⑥ 画像処理エンドポイント
// -------------------------------------------------------------
app.post('/api/process', upload.array('images', 20), async (req, res) => {
	const tempDir = req.tempDir;
	registerCleanup(res, tempDir);

	try {
		const files = req.files;
		if (!files || files.length === 0) {
			return res.status(400).json({ error: 'ファイルがアップロードされていません。' });
		}

		const { mode } = req.body;
		const processedResults = [];

		// ① トリミング
		if (mode === 'crop') {
			const file = files[0];
			const inputBuffer = await getUnifiedBuffer(file.path, file.originalname);
			const meta = await sharp(inputBuffer).metadata();

			const cropX = Math.max(0, Math.round(Number(req.body.x) || 0));
			const cropY = Math.max(0, Math.round(Number(req.body.y) || 0));
			const cropW = Math.min(meta.width - cropX, Math.round(Number(req.body.width) || meta.width));
			const cropH = Math.min(
				meta.height - cropY,
				Math.round(Number(req.body.height) || meta.height),
			);

			const outBuffer = await sharp(inputBuffer)
				.extract({ left: cropX, top: cropY, width: cropW, height: cropH })
				.png()
				.toBuffer();

			const outName = `cropped_${path.parse(file.originalname).name}.png`;
			processedResults.push({ buffer: outBuffer, name: outName, mime: 'image/png' });
		}

		// ② 傾き補正・回転
		else if (mode === 'rotate') {
			const file = files[0];
			const inputBuffer = await getUnifiedBuffer(file.path, file.originalname);
			const angle = parseFloat(req.body.angle) || 0;

			const outBuffer = await sharp(inputBuffer)
				.rotate(angle, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
				.png()
				.toBuffer();

			const outName = `rotated_${path.parse(file.originalname).name}.png`;
			processedResults.push({ buffer: outBuffer, name: outName, mime: 'image/png' });
		}

		// ③ サイズ変更
		else if (mode === 'resize') {
			const targetWidth = req.body.width ? parseInt(req.body.width, 10) : null;
			const targetHeight = req.body.height ? parseInt(req.body.height, 10) : null;
			const maintainAspect =
				req.body.maintainAspectRatio === 'true' || req.body.maintainAspectRatio === true;

			for (const file of files) {
				const inputBuffer = await getUnifiedBuffer(file.path, file.originalname);
				const resizeOptions = {
					width: targetWidth || undefined,
					height: targetHeight || undefined,
					fit: maintainAspect ? sharp.fit.inside : sharp.fit.fill,
					withoutEnlargement: false,
				};

				const outBuffer = await sharp(inputBuffer).resize(resizeOptions).png().toBuffer();

				const outName = `resized_${path.parse(file.originalname).name}.png`;
				processedResults.push({ buffer: outBuffer, name: outName, mime: 'image/png' });
			}
		}

		// ④ 背景透過（ローカル: BiRefNet）
		else if (mode === 'remove-bg') {
			const file = files[0];
			const inputBuffer = await getUnifiedBuffer(file.path, file.originalname);

			const { model, processor } = await loadBiRefNetModel();
			const inputBlob = new Blob([inputBuffer]);
			const rawImage = await RawImage.fromBlob(inputBlob);

			const { pixel_values } = await processor(rawImage);
			const { output_image } = await model({ input_image: pixel_values });

			const maskRaw = await RawImage.fromTensor(
				output_image[0].sigmoid().mul(255).to('uint8'),
			).resize(rawImage.width, rawImage.height);

			const { data: pixelData, info } = await sharp(inputBuffer)
				.ensureAlpha()
				.raw()
				.toBuffer({ resolveWithObject: true });

			const maskData = maskRaw.data;
			const totalPixels = info.width * info.height;

			const hairBoost = Math.max(0.5, Math.min(2.5, parseFloat(req.body.hairBoost) || 1.3));
			const edgeClean = Math.max(0, Math.min(40, parseFloat(req.body.edgeClean) || 6));

			for (let i = 0; i < totalPixels; i++) {
				let alpha = maskData[i];
				if (alpha <= edgeClean) {
					alpha = 0;
				} else if (alpha >= 245) {
					alpha = 255;
				} else {
					let norm = (alpha - edgeClean) / (255 - edgeClean);
					norm = Math.pow(norm, 1.0 / hairBoost);
					alpha = Math.round(Math.min(255, Math.max(0, norm * 255)));
				}
				pixelData[i * 4 + 3] = alpha;
			}

			const outBuffer = await sharp(pixelData, {
				raw: { width: info.width, height: info.height, channels: 4 },
			})
				.png({ compressionLevel: 8 })
				.toBuffer();

			const outName = `cutout_${path.parse(file.originalname).name}.png`;
			processedResults.push({ buffer: outBuffer, name: outName, mime: 'image/png' });
		}

		// ⑤ 形式変換
		else if (mode === 'convert') {
			const targetFormat = (req.body.targetFormat || 'png').toLowerCase();

			for (const file of files) {
				const inputBuffer = await getUnifiedBuffer(file.path, file.originalname);
				let sharpInstance = sharp(inputBuffer);
				let outBuffer;
				let outExt = targetFormat;

				if (targetFormat === 'jpg' || targetFormat === 'jpeg') {
					sharpInstance = sharpInstance.flatten({ background: { r: 255, g: 255, b: 255 } });
					outBuffer = await sharpInstance.jpeg({ quality: 92 }).toBuffer();
					outExt = 'jpg';
				} else if (targetFormat === 'png') {
					outBuffer = await sharpInstance.png().toBuffer();
					outExt = 'png';
				} else if (targetFormat === 'heic') {
					outBuffer = await sharpInstance.heif({ compression: 'hevc', quality: 90 }).toBuffer();
					outExt = 'heic';
				} else {
					outBuffer = await sharpInstance.toBuffer();
				}

				const outName = `${path.parse(file.originalname).name}.${outExt}`;
				processedResults.push({
					buffer: outBuffer,
					name: outName,
					mime:
						targetFormat === 'jpg'
							? 'image/jpeg'
							: targetFormat === 'heic'
								? 'image/heif'
								: 'image/png',
				});
			}
		}

		// ⑥ 画像圧縮 (最適化)
		else if (mode === 'compress') {
			const compressMode = req.body.compressMode || 'smart';

			for (const file of files) {
				const inputBuffer = await getUnifiedBuffer(file.path, file.originalname);
				const ext = path.extname(file.originalname).toLowerCase();
				let sharpInstance = sharp(inputBuffer);
				let outBuffer;
				let outName;
				let mimeType;

				if (ext === '.png' || ext === '.heic' || ext === '.heif') {
					if (compressMode === 'smart') {
						outBuffer = await sharpInstance
							.png({
								palette: true,
								quality: 90,
								effort: 10,
							})
							.toBuffer();
					} else {
						outBuffer = await sharpInstance
							.png({
								compressionLevel: 9,
								effort: 10,
							})
							.toBuffer();
					}
					outName = `compressed_${path.parse(file.originalname).name}.png`;
					mimeType = 'image/png';
				} else {
					if (compressMode === 'smart') {
						outBuffer = await sharpInstance
							.jpeg({
								quality: 85,
								mozjpeg: true,
							})
							.toBuffer();
					} else {
						outBuffer = await sharpInstance
							.jpeg({
								quality: 100,
								mozjpeg: true,
							})
							.toBuffer();
					}
					outName = `compressed_${path.parse(file.originalname).name}.jpg`;
					mimeType = 'image/jpeg';
				}

				processedResults.push({ buffer: outBuffer, name: outName, mime: mimeType });
			}
		} else {
			return res.status(400).json({ error: '無効な処理モードです。' });
		}

		if (processedResults.length > 1) {
			res.setHeader('Content-Type', 'application/zip');
			res.setHeader('Content-Disposition', 'attachment; filename="converted_images.zip"');

			const archive = archiver('zip', { zlib: { level: 9 } });
			archive.on('error', (err) => {
				throw err;
			});
			archive.pipe(res);

			for (const item of processedResults) {
				archive.append(item.buffer, { name: item.name });
			}
			await archive.finalize();
		} else {
			const single = processedResults[0];
			res.setHeader('Content-Type', single.mime);
			res.setHeader(
				'Content-Disposition',
				`attachment; filename="${encodeURIComponent(single.name)}"`,
			);
			res.send(single.buffer);
		}
	} catch (error) {
		console.error('画像処理実行時例外:', error);
		if (!res.headersSent) {
			res.status(500).json({ error: error.message || '画像処理中にエラーが発生しました。' });
		}
	}
});

// フロントエンド静的ファイルの配信 (4001ポート直接アクセス用)
const buildPath = '/var/www/html/image-converter/frontend/build';
app.use(express.static(buildPath));
app.get('*', (req, res) => {
	res.sendFile(path.join(buildPath, 'index.html'));
});

app.listen(PORT, () => {
	console.log(`Backend server is running on http://localhost:${PORT}`);
});
