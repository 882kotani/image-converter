import React, { useState, useRef, useEffect, useCallback } from 'react';
import ReactCrop from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import './App.css';

// 既存のポート構成を厳守（ローカル: 4001番、本番: 相対パス）
const API_BASE = window.location.port === '3000' ? 'http://localhost:4001' : '';

const MODES = [
	{ id: 'crop', label: '① トリミング' },
	{ id: 'rotate', label: '② 傾き補正・回転' },
	{ id: 'resize', label: '③ サイズ変更' },
	{ id: 'remove-bg', label: '④ 背景透過 (AI)' },
	{ id: 'convert', label: '⑤ 形式変換' },
	{ id: 'compress', label: '⑥ 画像圧縮' },
	{ id: 'fixed-crop', label: '⑦ 指定サイズ切り取り' },
	{ id: 'psd-ai-preview', label: '⑧ PSD & AI プレビュー' },
];

export default function App() {
	const [activeMode, setActiveMode] = useState('crop');
	const [selectedFiles, setSelectedFiles] = useState([]);
	const [previewUrls, setPreviewUrls] = useState([]);
	const [isLoading, setIsLoading] = useState(false);
	const [statusMessage, setStatusMessage] = useState('');
	const [errorMessage, setErrorMessage] = useState('');

	// ① トリミング用
	const [crop, setCrop] = useState({ unit: '%', width: 60, height: 60, x: 20, y: 20 });
	const [completedCrop, setCompletedCrop] = useState(null);
	const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
	const [renderedSize, setRenderedSize] = useState({ width: 0, height: 0 });
	const imgRef = useRef(null);

	// ② 回転用
	const [angle, setAngle] = useState(0);

	// ③ リサイズ用
	const [resizeWidth, setResizeWidth] = useState(800);
	const [resizeHeight, setResizeHeight] = useState(600);
	const [maintainAspect, setMaintainAspect] = useState(true);
	const [originalAspectRatio, setOriginalAspectRatio] = useState(1);

	// ④ 背景透過用
	const [hairBoost, setHairBoost] = useState(1.3);
	const [edgeClean, setEdgeClean] = useState(6);
	const [resultPreviewUrl, setResultPreviewUrl] = useState(null);
	const [previewBg, setPreviewBg] = useState('checker');

	// ⑤ 形式変換用
	const [targetFormat, setTargetFormat] = useState('png');

	// ⑥ 画像圧縮用
	const [compressMode, setCompressMode] = useState('smart');

	// ⑦ 指定サイズ切り取り用
	const [frameWidth, setFrameWidth] = useState(400);
	const [frameHeight, setFrameHeight] = useState(400);
	const [imgPos, setImgPos] = useState({ x: 0, y: 0 });
	const [imgZoom, setImgZoom] = useState(1.0);
	const [isDragging, setIsDragging] = useState(false);
	const dragStartRef = useRef({ x: 0, y: 0 });
	const fixedCropImgRef = useRef(null);

	// ⑧ PSD & AI プレビュー用ステート
	const [psdAiFileInfo, setPsdAiFileInfo] = useState(null);
	const [psdAiStatus, setPsdAiStatus] = useState('');
	const [psdAiNotice, setPsdAiNotice] = useState(null);
	const [psdAiViewMode, setPsdAiViewMode] = useState(null); // 'canvas' | 'thumb'
	const [hasBothViews, setHasBothViews] = useState(false);
	const [psdAiZoom, setPsdAiZoom] = useState(1.0);
	const [psdAiPan, setPsdAiPan] = useState({ x: 0, y: 0 });
	const [isPsdAiDragging, setIsPsdAiDragging] = useState(false);
	const psdAiDragStartRef = useRef({ x: 0, y: 0 });
	const [isInfoModalOpen, setIsInfoModalOpen] = useState(false);

	const psdAiCachedCanvasRef = useRef(null);
	const psdAiCachedImageRef = useRef(null);
	const psdAiMountRef = useRef(null);
	const psdAiStageRef = useRef(null);

	useEffect(() => {
		previewUrls.forEach((url) => URL.revokeObjectURL(url));
		if (resultPreviewUrl) URL.revokeObjectURL(resultPreviewUrl);

		if (selectedFiles.length === 0) {
			setPreviewUrls([]);
			setResultPreviewUrl(null);
			return;
		}

		const urls = selectedFiles.map((file) => {
			const ext = file.name.split('.').pop().toLowerCase();
			if (ext === 'heic' || ext === 'heif' || ext === 'psd' || ext === 'ai') return null;
			return URL.createObjectURL(file);
		});
		setPreviewUrls(urls);
		setResultPreviewUrl(null);

		if (selectedFiles.length === 1 && urls[0]) {
			const img = new Image();
			img.src = urls[0];
			img.onload = () => {
				setResizeWidth(img.naturalWidth);
				setResizeHeight(img.naturalHeight);
				setOriginalAspectRatio(img.naturalWidth / img.naturalHeight);
				setImgPos({ x: 0, y: 0 });
				setImgZoom(1.0);
			};
		}
	}, [selectedFiles]);

	const handleModeChange = (modeId) => {
		setActiveMode(modeId);
		setErrorMessage('');
		setStatusMessage('');
		if (
			['crop', 'rotate', 'remove-bg', 'fixed-crop', 'psd-ai-preview'].includes(modeId) &&
			selectedFiles.length > 1
		) {
			setSelectedFiles([selectedFiles[0]]);
		}
	};

	const handleFileChange = (e) => {
		const files = Array.from(e.target.files);
		if (!files.length) return;

		if (activeMode === 'psd-ai-preview') {
			setSelectedFiles([files[0]]);
			handlePsdAiFile(files[0]);
		} else if (['crop', 'rotate', 'remove-bg', 'fixed-crop'].includes(activeMode)) {
			setSelectedFiles([files[0]]);
		} else {
			setSelectedFiles(files);
		}
		setErrorMessage('');
	};

	const handleDrop = (e) => {
		e.preventDefault();
		const files = Array.from(e.dataTransfer.files);
		if (!files.length) return;

		if (activeMode === 'psd-ai-preview') {
			setSelectedFiles([files[0]]);
			handlePsdAiFile(files[0]);
		} else if (['crop', 'rotate', 'remove-bg', 'fixed-crop'].includes(activeMode)) {
			setSelectedFiles([files[0]]);
		} else {
			setSelectedFiles(files);
		}
		setErrorMessage('');
	};

	const handleDragOver = (e) => {
		e.preventDefault();
	};

	const onImageLoad = (e) => {
		const { naturalWidth, naturalHeight, width, height } = e.currentTarget;
		setNaturalSize({ width: naturalWidth, height: naturalHeight });
		setRenderedSize({ width, height });
		setCompletedCrop({
			unit: 'px',
			x: width * 0.2,
			y: height * 0.2,
			width: width * 0.6,
			height: height * 0.6,
		});
	};

	const handleWidthChange = (val) => {
		const w = parseInt(val, 10) || 0;
		setResizeWidth(w);
		if (maintainAspect && originalAspectRatio > 0) {
			setResizeHeight(Math.round(w / originalAspectRatio));
		}
	};

	const handleHeightChange = (val) => {
		const h = parseInt(val, 10) || 0;
		setResizeHeight(h);
		if (maintainAspect && originalAspectRatio > 0) {
			setResizeWidth(Math.round(h * originalAspectRatio));
		}
	};

	// -----------------------------------------------------------
	// ①〜⑥ 汎用画像変換の実行処理
	// -----------------------------------------------------------
	const handleExecute = async () => {
		if (selectedFiles.length === 0) {
			setErrorMessage('処理対象の画像ファイルを選択してください。');
			return;
		}

		setIsLoading(true);
		let msg = '処理中... しばらくお待ちください。';
		if (activeMode === 'remove-bg') msg = 'BiRefNet AIモデルで背景透過中...';
		if (activeMode === 'compress') msg = '高品質エンジンで画像圧縮・最適化中...';
		setStatusMessage(msg);
		setErrorMessage('');

		try {
			const formData = new FormData();
			formData.append('mode', activeMode);
			selectedFiles.forEach((file) => formData.append('images', file));

			if (activeMode === 'crop') {
				if (!completedCrop || !imgRef.current)
					throw new Error('トリミング範囲が設定されていません。');
				const sX = naturalSize.width / renderedSize.width;
				const sY = naturalSize.height / renderedSize.height;
				formData.append('x', Math.round(completedCrop.x * sX));
				formData.append('y', Math.round(completedCrop.y * sY));
				formData.append('width', Math.round(completedCrop.width * sX));
				formData.append('height', Math.round(completedCrop.height * sY));
			} else if (activeMode === 'rotate') {
				formData.append('angle', angle);
			} else if (activeMode === 'resize') {
				formData.append('width', resizeWidth);
				formData.append('height', resizeHeight);
				formData.append('maintainAspectRatio', maintainAspect);
			} else if (activeMode === 'remove-bg') {
				formData.append('hairBoost', hairBoost);
				formData.append('edgeClean', edgeClean);
			} else if (activeMode === 'convert') {
				formData.append('targetFormat', targetFormat);
			} else if (activeMode === 'compress') {
				formData.append('compressMode', compressMode);
			}

			const response = await fetch(`${API_BASE}/api/process`, {
				method: 'POST',
				body: formData,
			});

			if (!response.ok) {
				let errText = '変換処理に失敗しました。';
				try {
					const errData = await response.json();
					errText = errData.error || errText;
				} catch (_) {}
				throw new Error(errText);
			}

			const disposition = response.headers.get('Content-Disposition');
			let downloadFilename = '';

			if (disposition && disposition.includes('filename=')) {
				const matches = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(disposition);
				if (matches && matches[1]) {
					downloadFilename = decodeURIComponent(matches[1].replace(/['"]/g, ''));
				}
			}

			if (!downloadFilename) {
				if (selectedFiles.length > 1) {
					downloadFilename = 'converted_images.zip';
				} else {
					const originalFile = selectedFiles[0];
					const originalName = originalFile ? originalFile.name : 'image';
					const originalBase = originalName.replace(/\.[^/.]+$/, '');
					const originalExt = (originalName.split('.').pop() || 'png').toLowerCase();

					let ext = 'png';
					if (activeMode === 'convert') {
						ext = targetFormat.toLowerCase() === 'jpeg' ? 'jpg' : targetFormat.toLowerCase();
					} else if (activeMode === 'compress') {
						ext = originalExt === 'jpg' || originalExt === 'jpeg' ? 'jpg' : 'png';
					} else if (activeMode === 'crop' || activeMode === 'rotate' || activeMode === 'resize') {
						ext = 'png';
					}

					downloadFilename = `${activeMode}_${originalBase}.${ext}`;
				}
			}

			const blob = await response.blob();
			const downloadUrl = window.URL.createObjectURL(blob);

			if (activeMode === 'remove-bg') {
				setResultPreviewUrl(downloadUrl);
			}

			const a = document.createElement('a');
			a.href = downloadUrl;
			a.download = downloadFilename;
			document.body.appendChild(a);
			a.click();
			a.remove();

			setStatusMessage(`処理が完了し、ダウンロードを開始しました（${downloadFilename}）。`);
		} catch (err) {
			setErrorMessage(err.message || 'エラーが発生しました。');
		} finally {
			setIsLoading(false);
		}
	};

	// -----------------------------------------------------------
	// ⑦ 指定サイズ切り取り（完全維持）
	// -----------------------------------------------------------
	const handleFixedCropMouseDown = (e) => {
		setIsDragging(true);
		dragStartRef.current = { x: e.clientX - imgPos.x, y: e.clientY - imgPos.y };
	};

	const handleFixedCropMouseMove = (e) => {
		if (!isDragging) return;
		setImgPos({
			x: e.clientX - dragStartRef.current.x,
			y: e.clientY - dragStartRef.current.y,
		});
	};

	const handleFixedCropMouseUp = () => {
		setIsDragging(false);
	};

	const handleFixedCropTouchStart = (e) => {
		if (e.touches.length === 1) {
			setIsDragging(true);
			dragStartRef.current = {
				x: e.touches[0].clientX - imgPos.x,
				y: e.touches[0].clientY - imgPos.y,
			};
		}
	};

	const handleFixedCropTouchMove = (e) => {
		if (!isDragging || e.touches.length !== 1) return;
		setImgPos({
			x: e.touches[0].clientX - dragStartRef.current.x,
			y: e.touches[0].clientY - dragStartRef.current.y,
		});
	};

	const handleFixedCropWheel = (e) => {
		e.preventDefault();
		const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92;
		setImgZoom((prev) => {
			const next = prev * zoomFactor;
			return Math.min(5.0, Math.max(0.1, parseFloat(next.toFixed(3))));
		});
	};

	const changeZoom = (delta) => {
		setImgZoom((prev) => {
			const next = prev + delta;
			return Math.min(5.0, Math.max(0.1, parseFloat(next.toFixed(2))));
		});
	};

	const fitToFrame = () => {
		if (!fixedCropImgRef.current) return;
		const img = fixedCropImgRef.current;
		const tW = Math.max(1, parseInt(frameWidth, 10) || 400);
		const tH = Math.max(1, parseInt(frameHeight, 10) || 400);
		const scale = Math.max(tW / img.naturalWidth, tH / img.naturalHeight);
		setImgZoom(parseFloat(scale.toFixed(3)));
		setImgPos({ x: 0, y: 0 });
	};

	const handleFixedCropExecute = () => {
		if (!fixedCropImgRef.current || !previewUrls[0]) {
			setErrorMessage('切り取る画像が読み込まれていません。');
			return;
		}

		const tW = Math.max(1, parseInt(frameWidth, 10) || 400);
		const tH = Math.max(1, parseInt(frameHeight, 10) || 400);

		const maxDisplayW = 560;
		const maxDisplayH = 420;
		const displayScale = Math.min(1, maxDisplayW / tW, maxDisplayH / tH);

		const canvas = document.createElement('canvas');
		canvas.width = tW;
		canvas.height = tH;
		const ctx = canvas.getContext('2d');

		const img = fixedCropImgRef.current;

		ctx.translate(tW / 2 + imgPos.x / displayScale, tH / 2 + imgPos.y / displayScale);
		ctx.scale(imgZoom, imgZoom);
		ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);

		canvas.toBlob((blob) => {
			if (!blob) {
				setErrorMessage('画像の切り取りに失敗しました。');
				return;
			}
			const downloadUrl = window.URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = downloadUrl;
			const originalBase = selectedFiles[0]
				? selectedFiles[0].name.replace(/\.[^/.]+$/, '')
				: 'image';
			a.download = `crop_${tW}x${tH}_${originalBase}.png`;
			document.body.appendChild(a);
			a.click();
			a.remove();
			window.URL.revokeObjectURL(downloadUrl);
			setStatusMessage(`指定サイズ (${tW} × ${tH} px) で切り取り、ダウンロードしました。`);
		}, 'image/png');
	};

	// -----------------------------------------------------------
	// ⑧ PSD & AI プレビュー処理ロジック
	// -----------------------------------------------------------
	const formatFileSize = (bytes) => {
		if (bytes === 0) return '0 Bytes';
		const k = 1024;
		const sizes = ['Bytes', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
	};

	const resetPsdAiZoomPan = () => {
		setPsdAiZoom(1.0);
		setPsdAiPan({ x: 0, y: 0 });
	};

	const cleanBase64String = (str) => {
		if (!str) return null;
		let cleaned = str.replace(/&#x[a-f0-9]+;/gi, '');
		cleaned = cleaned.replace(/[^A-Za-z0-9+/=]/g, '');
		while (cleaned.length % 4 !== 0) {
			cleaned += '=';
		}
		return cleaned.length > 50 ? cleaned : null;
	};

	const extractBase64FromText = (text) => {
		if (!text) return null;
		const tagMatch = text.match(
			/<(?:[a-zA-Z0-9_-]+:)?image[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?image>/i,
		);
		if (tagMatch && tagMatch[1]) {
			const cleaned = cleanBase64String(tagMatch[1]);
			if (cleaned) return cleaned;
		}
		const attrMatch = text.match(/(?:[a-zA-Z0-9_-]+:)?image=["']([^"']+)["']/i);
		if (attrMatch && attrMatch[1]) {
			const cleaned = cleanBase64String(attrMatch[1]);
			if (cleaned) return cleaned;
		}
		const rawMatch = text.match(/\/9j\/[A-Za-z0-9+/=\s&#;]{200,}/);
		if (rawMatch && rawMatch[0]) {
			const cleaned = cleanBase64String(rawMatch[0]);
			if (cleaned) return cleaned;
		}
		return null;
	};

	const extractJpegBlobFromBinary = (arrayBuffer) => {
		const bytes = new Uint8Array(arrayBuffer);
		const len = bytes.length;
		for (let i = 0; i < len - 4; i++) {
			if (bytes[i] === 0xff && bytes[i + 1] === 0xd8 && bytes[i + 2] === 0xff) {
				for (let j = i + 3; j < len - 1; j++) {
					if (bytes[j] === 0xff && bytes[j + 1] === 0xd9) {
						if (j - i > 1024) {
							const jpegData = bytes.slice(i, j + 2);
							return new Blob([jpegData], { type: 'image/jpeg' });
						}
					}
				}
			}
		}
		return null;
	};

	const extractOldAIThumbnail = (text) => {
		let headerMatch = text.match(
			/%(?:AI[789]_Thumbnail|%BeginThumbnail):\s*(\d+)\s+(\d+)\s+(\d+)/i,
		);
		if (!headerMatch) {
			headerMatch = text.match(/%%BeginPreview:\s*(\d+)\s+(\d+)\s+(\d+)/i);
		}
		if (!headerMatch) return null;

		const width = parseInt(headerMatch[1], 10);
		const height = parseInt(headerMatch[2], 10);
		const depth = parseInt(headerMatch[3], 10);

		const beginMatch = text.match(
			/%%Begin(?:Data:[^\r\n]*Hex\s+Bytes|Thumbnail[^\r\n]*|Preview[^\r\n]*)/i,
		);
		if (!beginMatch) return null;

		const startPos = beginMatch.index + beginMatch[0].length;
		const endMatch = text.slice(startPos).match(/%%End(?:Data|Thumbnail|Preview)/i);
		if (!endMatch) return null;

		const rawHexText = text.slice(startPos, startPos + endMatch.index);
		const hexClean = rawHexText.replace(/[^0-9A-Fa-f]/g, '');
		if (hexClean.length < 50) return null;

		const byteLen = Math.floor(hexClean.length / 2);
		const rawBytes = new Uint8Array(byteLen);
		for (let i = 0; i < byteLen; i++) {
			rawBytes[i] = parseInt(hexClean.substring(i * 2, i * 2 + 2), 16);
		}

		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext('2d');
		const imgData = ctx.createImageData(width, height);
		const totalPixels = width * height;

		if (depth === 8) {
			let rleIndex = -1;
			for (let i = 0; i < rawBytes.length - 2; i++) {
				if (rawBytes[i] === 0x52 && rawBytes[i + 1] === 0x4c && rawBytes[i + 2] === 0x45) {
					rleIndex = i;
					break;
				}
			}

			let palette = null;
			let pixelIndices = [];

			if (rleIndex !== -1) {
				palette = rawBytes.subarray(0, rleIndex);
				let p = rleIndex + 3;

				while (p < rawBytes.length && pixelIndices.length < totalPixels) {
					const b = rawBytes[p];
					if (b === 0xfd) {
						if (p + 1 < rawBytes.length && rawBytes[p + 1] === 0) {
							pixelIndices.push(0xfd);
							p += 2;
						} else if (p + 2 < rawBytes.length) {
							const count = rawBytes[p + 1];
							const val = rawBytes[p + 2];
							for (let c = 0; c < count && pixelIndices.length < totalPixels; c++) {
								pixelIndices.push(val);
							}
							p += 3;
						} else {
							break;
						}
					} else {
						pixelIndices.push(b);
						p += 1;
					}
				}
			} else {
				palette = rawBytes.subarray(0, Math.min(768, rawBytes.length));
				for (let i = 768; i < rawBytes.length && pixelIndices.length < totalPixels; i++) {
					pixelIndices.push(rawBytes[i]);
				}
			}

			for (let i = 0; i < totalPixels; i++) {
				const colorIdx = pixelIndices[i] || 0;
				const r = palette[colorIdx * 3] !== undefined ? palette[colorIdx * 3] : 255;
				const g = palette[colorIdx * 3 + 1] !== undefined ? palette[colorIdx * 3 + 1] : 255;
				const b = palette[colorIdx * 3 + 2] !== undefined ? palette[colorIdx * 3 + 2] : 255;

				imgData.data[i * 4] = r;
				imgData.data[i * 4 + 1] = g;
				imgData.data[i * 4 + 2] = b;
				imgData.data[i * 4 + 3] = 255;
			}
		} else if (depth === 1) {
			let pixelIdx = 0;
			for (let i = 0; i < rawBytes.length && pixelIdx < totalPixels; i++) {
				const b = rawBytes[i];
				for (let bit = 7; bit >= 0 && pixelIdx < totalPixels; bit--) {
					const val = (b >> bit) & 1 ? 255 : 0;
					imgData.data[pixelIdx * 4] = val;
					imgData.data[pixelIdx * 4 + 1] = val;
					imgData.data[pixelIdx * 4 + 2] = val;
					imgData.data[pixelIdx * 4 + 3] = 255;
					pixelIdx++;
				}
			}
		} else if (depth === 24) {
			for (let i = 0; i < totalPixels && i * 3 + 2 < rawBytes.length; i++) {
				imgData.data[i * 4] = rawBytes[i * 3];
				imgData.data[i * 4 + 1] = rawBytes[i * 3 + 1];
				imgData.data[i * 4 + 2] = rawBytes[i * 3 + 2];
				imgData.data[i * 4 + 3] = 255;
			}
		}

		ctx.putImageData(imgData, 0, 0);
		return {
			dataUrl: canvas.toDataURL('image/png'),
			width: width,
			height: height,
		};
	};

	const processPSD = (arrayBuffer) => {
		try {
			if (typeof window.agPsd === 'undefined') {
				throw new Error('ag-psd ライブラリが読み込まれていません。');
			}

			let psd = null;
			try {
				psd = window.agPsd.readPsd(arrayBuffer, { skipLayerImageData: true });
			} catch (e1) {
				console.warn('統合画像スキップ読み込み失敗:', e1);
				psd = window.agPsd.readPsd(arrayBuffer);
			}

			if (psd && psd.canvas) {
				psdAiCachedCanvasRef.current = psd.canvas;
				setPsdAiViewMode('canvas');
				setPsdAiStatus('成功 (PSD統合画像描画)');
				return;
			}
		} catch (error) {
			console.warn('PSDパース失敗:', error);
		}

		const jpegBlob = extractJpegBlobFromBinary(arrayBuffer);
		if (jpegBlob) {
			const img = document.createElement('img');
			img.src = URL.createObjectURL(jpegBlob);
			psdAiCachedImageRef.current = img;
			setPsdAiViewMode('thumb');
			setPsdAiStatus('成功 (PSDサムネイル描画)');
			setPsdAiNotice(
				'<strong>【注記】</strong>PSDのレイヤー構造が複雑なため、埋め込まれている合成サムネイル画像を表示しています。',
			);
		} else {
			setPsdAiStatus('エラー: PSDのパースおよびサムネイル抽出に失敗しました。');
		}
	};

	const processAI = async (arrayBuffer) => {
		let thumbnailSrc = null;
		let thumbDimensions = null;
		let isOldAIType = false;
		let isDummyWarningPdf = false;
		const decoder = new TextDecoder('iso-8859-1');
		let text = '';

		try {
			text = decoder.decode(arrayBuffer.slice(0, Math.min(arrayBuffer.byteLength, 5000000)));

			const b64 = extractBase64FromText(text);
			if (b64) {
				thumbnailSrc = 'data:image/jpeg;base64,' + b64;
			} else {
				const oldThumb = extractOldAIThumbnail(text);
				if (oldThumb) {
					thumbnailSrc = oldThumb.dataUrl;
					thumbDimensions = oldThumb;
					isOldAIType = true;
				}
			}
		} catch (e) {
			console.warn('テキスト解析失敗:', e);
		}

		try {
			if (typeof window.pdfjsLib === 'undefined') {
				throw new Error('PDF.js ライブラリが読み込まれていません。');
			}

			const uint8Array = new Uint8Array(arrayBuffer);
			const loadingTask = window.pdfjsLib.getDocument({ data: uint8Array });
			const pdf = await loadingTask.promise;

			if (!thumbnailSrc) {
				try {
					const meta = await pdf.getMetadata();
					if (meta && meta.metadata) {
						const rawXmp = meta.metadata.getRaw();
						const b64 = extractBase64FromText(rawXmp);
						if (b64) thumbnailSrc = 'data:image/jpeg;base64,' + b64;
					}
				} catch (e) {
					console.warn('PDF内部メタデータ取得スキップ:', e);
				}
			}

			const page = await pdf.getPage(1);
			const textContent = await page.getTextContent();
			const textString = textContent.items
				.map((item) => item.str)
				.join('')
				.replace(/\s/g, '');

			if (
				textString.includes('互換ファイル') ||
				textString.includes('PDF内容を含まず') ||
				textString.includes('withoutPDFcontent') ||
				textString.includes('withoutPDFContent') ||
				textString.includes('保存されたAdobeIllustrator')
			) {
				isDummyWarningPdf = true;
			}

			const opList = await page.getOperatorList();
			if (opList.fnArray.length < 250 && textContent.items.length < 30) {
				isDummyWarningPdf = true;
			}

			const scale = 1.5;
			const viewport = page.getViewport({ scale: scale });
			const canvas = document.createElement('canvas');
			canvas.height = viewport.height;
			canvas.width = viewport.width;
			await page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise;
			psdAiCachedCanvasRef.current = canvas;
		} catch (pdfErr) {
			console.warn('PDFレンダリング対象外（旧形式AIなど）:', pdfErr);
			isDummyWarningPdf = true;
		}

		if (!thumbnailSrc) {
			const jpegBlob = extractJpegBlobFromBinary(arrayBuffer);
			if (jpegBlob) {
				thumbnailSrc = URL.createObjectURL(jpegBlob);
			}
		}

		if (thumbnailSrc) {
			const img = document.createElement('img');
			img.src = thumbnailSrc;
			if (thumbDimensions && thumbDimensions.width < 300) {
				img.style.width = Math.min(thumbDimensions.width * 4, 600) + 'px';
				img.style.height = 'auto';
				img.style.imageRendering = 'pixelated';
			}
			psdAiCachedImageRef.current = img;
		}

		if (isDummyWarningPdf && psdAiCachedImageRef.current) {
			setPsdAiViewMode('thumb');
			setPsdAiStatus('※PDF互換なし（サムネイルを表示中）');
			setPsdAiNotice(
				'<strong>【注記：PDF互換なしファイル】</strong>このAIファイルは「PDF互換ファイルを作成」が無効で保存されているため、内部の埋め込みサムネイル画像を表示しています。完全なベクター表示を行うには、Illustrator等で保存時に「PDF互換ファイルを作成」にチェックを入れて保存してください。',
			);
			setHasBothViews(!!psdAiCachedCanvasRef.current);
		} else if (psdAiCachedCanvasRef.current) {
			setPsdAiViewMode('canvas');
			setPsdAiStatus('成功 (PDF描画)');
			setPsdAiNotice(null);
			setHasBothViews(!!psdAiCachedImageRef.current);
		} else if (psdAiCachedImageRef.current) {
			setPsdAiViewMode('thumb');
			setPsdAiStatus('※旧Illustrator形式（サムネイルを表示中）');
			setHasBothViews(false);
			if (isOldAIType) {
				setPsdAiNotice(
					'<strong>【注記：旧形式（Illustrator 8以前）のファイル】</strong>このAIファイルはPDF互換ストリームを持たない旧式PostScript形式です。ファイル内に自動記録されている低解像度の簡易サムネイルを表示しているため、一部のオブジェクトや装飾が表示されない場合があります。完全な表示が必要な場合は、Illustratorで開き直して最新形式で保存してください。',
				);
			} else {
				setPsdAiNotice(
					'<strong>【注記】</strong>ベクターデータではなく、ファイル内に記録されているサムネイル画像を表示しています。',
				);
			}
		} else {
			setPsdAiStatus('エラー: サムネイルおよびPDF解析の両方が行えませんでした。');
			setPsdAiNotice(
				'<strong>【表示不可】</strong>PDF互換データがなく、ファイル内に有効なプレビュー用サムネイルも埋め込まれていません。',
			);
			setHasBothViews(false);
		}
	};

	const handlePsdAiFile = (file) => {
		const ext = file.name.split('.').pop().toLowerCase();
		setPsdAiFileInfo({
			name: file.name,
			size: formatFileSize(file.size),
		});
		setPsdAiStatus('読み込み中...');
		setPsdAiNotice(null);
		setPsdAiViewMode(null);
		setHasBothViews(false);
		psdAiCachedCanvasRef.current = null;
		psdAiCachedImageRef.current = null;
		resetPsdAiZoomPan();

		const reader = new FileReader();

		if (ext === 'psd') {
			reader.onload = (e) => processPSD(e.target.result);
			reader.readAsArrayBuffer(file);
		} else if (ext === 'ai') {
			reader.onload = (e) => processAI(e.target.result);
			reader.readAsArrayBuffer(file);
		} else {
			setPsdAiStatus('エラー: .psd または .ai ファイルのみ対応しています。');
		}
	};

	// 【安全な生DOMマウント処理】React管理ツリーと生DOMツリーを完全分離
	useEffect(() => {
		if (activeMode !== 'psd-ai-preview') return;
		const mountEl = psdAiMountRef.current;
		if (!mountEl) return;

		// 前の子要素をクリーンアップ
		while (mountEl.firstChild) {
			mountEl.removeChild(mountEl.firstChild);
		}

		let targetEl = null;
		if (psdAiViewMode === 'canvas' && psdAiCachedCanvasRef.current) {
			targetEl = psdAiCachedCanvasRef.current;
		} else if (psdAiViewMode === 'thumb' && psdAiCachedImageRef.current) {
			targetEl = psdAiCachedImageRef.current;
		}

		if (targetEl) {
			targetEl.style.transform = `translate(${psdAiPan.x}px, ${psdAiPan.y}px) scale(${psdAiZoom})`;
			targetEl.style.transformOrigin = 'center center';
			mountEl.appendChild(targetEl);
		}
	}, [activeMode, psdAiViewMode, psdAiZoom, psdAiPan]);

	// マウスホイールによる直感的な拡大縮小（パッシブ無効化で登録）
	useEffect(() => {
		if (activeMode !== 'psd-ai-preview') return;
		const stageEl = psdAiStageRef.current;
		if (!stageEl) return;

		const handleWheel = (e) => {
			if (!psdAiViewMode) return;
			e.preventDefault();
			const zoomStep = 0.1;
			setPsdAiZoom((prev) => {
				const next = e.deltaY < 0 ? prev + zoomStep : prev - zoomStep;
				return Math.max(0.1, Math.min(5.0, parseFloat(next.toFixed(2))));
			});
		};

		stageEl.addEventListener('wheel', handleWheel, { passive: false });
		return () => {
			stageEl.removeEventListener('wheel', handleWheel);
		};
	}, [activeMode, psdAiViewMode]);

	const handlePsdAiMouseDown = (e) => {
		if (!psdAiViewMode) return;
		setIsPsdAiDragging(true);
		psdAiDragStartRef.current = {
			x: e.clientX - psdAiPan.x,
			y: e.clientY - psdAiPan.y,
		};
	};

	const handlePsdAiMouseMove = useCallback(
		(e) => {
			if (!isPsdAiDragging) return;
			setPsdAiPan({
				x: e.clientX - psdAiDragStartRef.current.x,
				y: e.clientY - psdAiDragStartRef.current.y,
			});
		},
		[isPsdAiDragging],
	);

	const handlePsdAiMouseUp = useCallback(() => {
		setIsPsdAiDragging(false);
	}, []);

	useEffect(() => {
		if (isPsdAiDragging) {
			window.addEventListener('mousemove', handlePsdAiMouseMove);
			window.addEventListener('mouseup', handlePsdAiMouseUp);
		} else {
			window.removeEventListener('mousemove', handlePsdAiMouseMove);
			window.removeEventListener('mouseup', handlePsdAiMouseUp);
		}
		return () => {
			window.removeEventListener('mousemove', handlePsdAiMouseMove);
			window.removeEventListener('mouseup', handlePsdAiMouseUp);
		};
	}, [isPsdAiDragging, handlePsdAiMouseMove, handlePsdAiMouseUp]);

	const scaleX = renderedSize.width > 0 ? naturalSize.width / renderedSize.width : 1;
	const scaleY = renderedSize.height > 0 ? naturalSize.height / renderedSize.height : 1;
	const currentCropW = completedCrop ? Math.round(completedCrop.width * scaleX) : 0;
	const currentCropH = completedCrop ? Math.round(completedCrop.height * scaleY) : 0;
	const isMultipleAllowed =
		activeMode === 'resize' || activeMode === 'convert' || activeMode === 'compress';

	const currentFrameW = Math.max(1, parseInt(frameWidth, 10) || 400);
	const currentFrameH = Math.max(1, parseInt(frameHeight, 10) || 400);
	const fixedDisplayScale = Math.min(1, 560 / currentFrameW, 420 / currentFrameH);
	const fixedDisplayW = Math.round(currentFrameW * fixedDisplayScale);
	const fixedDisplayH = Math.round(currentFrameH * fixedDisplayScale);

	return (
		<div className="container">
			<header className="header">
				<h1>画像ファイル変換ツール</h1>
				<p className="subtitle">高速・高品質な画像編集・変換ワークスペース</p>
			</header>

			<nav className="tabs">
				{MODES.map((mode) => (
					<button
						key={mode.id}
						className={`tab-btn ${activeMode === mode.id ? 'active' : ''}`}
						onClick={() => handleModeChange(mode.id)}
					>
						{mode.label}
					</button>
				))}
			</nav>

			<main className="main-content">
				<section
					className="drop-zone"
					onDrop={handleDrop}
					onDragOver={handleDragOver}
					onClick={() => document.getElementById('fileInput').click()}
				>
					<input
						id="fileInput"
						type="file"
						multiple={isMultipleAllowed}
						accept={activeMode === 'psd-ai-preview' ? '.psd,.ai' : '.png,.jpg,.jpeg,.heic,.heif'}
						style={{ display: 'none' }}
						onChange={handleFileChange}
					/>
					<div className="drop-zone-text">
						<span className="icon">{activeMode === 'psd-ai-preview' ? '🎨' : '📁'}</span>
						<p>
							<strong>クリックしてファイルを選択</strong> またはここにドラッグ＆ドロップ
						</p>
						<span className="hint">
							{activeMode === 'psd-ai-preview'
								? '対応形式: Adobe Photoshop (.psd) / Illustrator (.ai) [ブラウザ完結処理]'
								: `対応形式: PNG, JPG, HEIC ${
										isMultipleAllowed ? '（複数画像の一括選択に対応）' : ''
									}`}
						</span>
					</div>
				</section>

				{selectedFiles.length > 0 && activeMode !== 'psd-ai-preview' && (
					<div className="file-list">
						<strong>選択中のファイル ({selectedFiles.length}件):</strong>
						<ul>
							{selectedFiles.map((f, idx) => (
								<li key={idx}>
									{f.name} ({(f.size / 1024).toFixed(1)} KB)
								</li>
							))}
						</ul>
					</div>
				)}

				<section className="params-card">
					{/* ① トリミング */}
					{activeMode === 'crop' && (
						<div>
							<h3>トリミング設定</h3>
							<div className="dimension-bar">
								<span>
									元画像サイズ:{' '}
									<strong>
										{naturalSize.width} × {naturalSize.height} px
									</strong>
								</span>
								<span>
									現在のクロップ枠:{' '}
									<strong>
										{currentCropW} × {currentCropH} px
									</strong>
								</span>
							</div>
							<div className="preview-container">
								{previewUrls[0] ? (
									<ReactCrop
										crop={crop}
										onChange={(c) => setCrop(c)}
										onComplete={(c) => setCompletedCrop(c)}
									>
										<img
											ref={imgRef}
											src={previewUrls[0]}
											alt="Crop target"
											onLoad={onImageLoad}
											className="crop-img"
											draggable={false}
										/>
									</ReactCrop>
								) : (
									<p className="no-preview-text">画像をアップロードしてください。</p>
								)}
							</div>
						</div>
					)}

					{/* ② 傾き補正・回転 */}
					{activeMode === 'rotate' && (
						<div>
							<h3>傾き補正・回転設定</h3>
							<div className="rotate-control">
								<label>回転角度 (-180° 〜 +180°):</label>
								<div className="slider-box">
									<input
										type="range"
										min="-180"
										max="180"
										value={angle}
										onChange={(e) => setAngle(parseFloat(e.target.value))}
									/>
									<input
										type="number"
										min="-180"
										max="180"
										value={angle}
										onChange={(e) => setAngle(parseFloat(e.target.value) || 0)}
										className="number-input"
									/>
									<span>度</span>
								</div>
							</div>
							<div className="preview-container checkerboard">
								{previewUrls[0] ? (
									<div className="rotate-wrapper">
										<img
											src={previewUrls[0]}
											alt="Rotate Preview"
											style={{ transform: `rotate(${angle}deg)` }}
											className="rotate-img"
										/>
									</div>
								) : (
									<p className="no-preview-text">画像をアップロードしてください。</p>
								)}
							</div>
						</div>
					)}

					{/* ③ サイズ変更 */}
					{activeMode === 'resize' && (
						<div>
							<h3>サイズ変更設定</h3>
							<div className="form-group inline">
								<div>
									<label>幅 (px):</label>
									<input
										type="number"
										value={resizeWidth}
										onChange={(e) => handleWidthChange(e.target.value)}
										className="number-input"
									/>
								</div>
								<div>
									<label>高さ (px):</label>
									<input
										type="number"
										value={resizeHeight}
										onChange={(e) => handleHeightChange(e.target.value)}
										className="number-input"
									/>
								</div>
								<div className="toggle-wrapper">
									<label className="checkbox-label">
										<input
											type="checkbox"
											checked={maintainAspect}
											onChange={(e) => setMaintainAspect(e.target.checked)}
										/>
										アスペクト比を固定
									</label>
								</div>
							</div>
						</div>
					)}

					{/* ④ 背景透過 */}
					{activeMode === 'remove-bg' && (
						<div>
							<h3>AI背景除去（BiRefNet）</h3>
							<p>サーバー内のAIモデルを使用します。通信コストゼロで高速に処理可能です。</p>
							<div className="matting-controls">
								<div className="control-row">
									<label>
										毛先保護感度: <strong>{hairBoost.toFixed(2)}</strong>
									</label>
									<input
										type="range"
										min="0.8"
										max="2.0"
										step="0.05"
										value={hairBoost}
										onChange={(e) => setHairBoost(parseFloat(e.target.value))}
									/>
								</div>
								<div className="control-row">
									<label>
										背景クリーンカット: <strong>{edgeClean}</strong>
									</label>
									<input
										type="range"
										min="0"
										max="25"
										step="1"
										value={edgeClean}
										onChange={(e) => setEdgeClean(parseInt(e.target.value, 10))}
									/>
								</div>
							</div>
							{resultPreviewUrl && (
								<div className="bg-switcher-bar">
									<button
										className={`bg-chip ${previewBg === 'checker' ? 'active' : ''}`}
										onClick={() => setPreviewBg('checker')}
									>
										透過
									</button>
									<button
										className={`bg-chip ${previewBg === 'black' ? 'active' : ''}`}
										onClick={() => setPreviewBg('black')}
									>
										黒背景
									</button>
									<button
										className={`bg-chip ${previewBg === 'white' ? 'active' : ''}`}
										onClick={() => setPreviewBg('white')}
									>
										白背景
									</button>
								</div>
							)}
							<div
								className={`preview-container ${
									resultPreviewUrl ? `bg-${previewBg}` : 'checkerboard'
								}`}
							>
								{resultPreviewUrl ? (
									<img src={resultPreviewUrl} alt="Cutout" className="preview-img" />
								) : previewUrls[0] ? (
									<img src={previewUrls[0]} alt="Preview" className="preview-img" />
								) : (
									<p className="no-preview-text">画像をアップロードしてください。</p>
								)}
							</div>
						</div>
					)}

					{/* ⑤ 形式変換 */}
					{activeMode === 'convert' && (
						<div>
							<h3>ファイル形式変換</h3>
							<div className="format-selector">
								{['png', 'jpg', 'heic'].map((fmt) => (
									<button
										key={fmt}
										className={`format-btn ${targetFormat === fmt ? 'selected' : ''}`}
										onClick={() => setTargetFormat(fmt)}
									>
										{fmt.toUpperCase()}
									</button>
								))}
							</div>
						</div>
					)}

					{/* ⑥ 画像圧縮 */}
					{activeMode === 'compress' && (
						<div>
							<h3>画像圧縮・最適化（一括対応）</h3>
							<p>
								縦横の解像度はそのままに、ファイルサイズのみを軽量化します。
								<br />
								PNG画像の背景透過（アルファチャンネル）も完全に維持されます。
							</p>
							<div className="form-group" style={{ marginTop: '16px' }}>
								<label>圧縮モード設定:</label>
								<div className="format-selector">
									<button
										className={`format-btn ${compressMode === 'smart' ? 'selected' : ''}`}
										onClick={() => setCompressMode('smart')}
									>
										スマート圧縮 (推奨)
									</button>
									<button
										className={`format-btn ${compressMode === 'lossless' ? 'selected' : ''}`}
										onClick={() => setCompressMode('lossless')}
									>
										完全ロスレス
									</button>
								</div>
							</div>
							<div className="preview-container checkerboard" style={{ marginTop: '20px' }}>
								{previewUrls[0] ? (
									<img src={previewUrls[0]} alt="Subject Preview" className="preview-img" />
								) : (
									<p className="no-preview-text">圧縮したい画像をアップロードしてください。</p>
								)}
							</div>
						</div>
					)}

					{/* ⑦ 指定サイズ切り取り */}
					{activeMode === 'fixed-crop' && (
						<div>
							<h3>指定サイズ切り取り（枠固定・画像移動）</h3>
							<p>
								枠サイズ（px）を入力し、<strong>画像をドラッグして位置を調整</strong>できます。
								<br />
								<strong>マウスホイール</strong>または<strong>画面のボタン</strong>
								で画像の拡大縮小が可能です。
							</p>

							<div className="form-group inline" style={{ marginTop: '14px' }}>
								<div>
									<label>枠の幅 (px):</label>
									<input
										type="number"
										min="10"
										max="5000"
										value={frameWidth}
										onChange={(e) => setFrameWidth(e.target.value)}
										className="number-input"
									/>
								</div>
								<div>
									<label>枠の高さ (px):</label>
									<input
										type="number"
										min="10"
										max="5000"
										value={frameHeight}
										onChange={(e) => setFrameHeight(e.target.value)}
										className="number-input"
									/>
								</div>
								<div>
									<label>画像拡大/縮小 (GUI):</label>
									<div className="zoom-gui-toolbar">
										<button type="button" className="sub-btn" onClick={() => changeZoom(0.1)}>
											＋ 拡大
										</button>
										<button type="button" className="sub-btn" onClick={() => changeZoom(-0.1)}>
											－ 縮小
										</button>
										<button
											type="button"
											className="sub-btn"
											onClick={() => {
												setImgZoom(1.0);
												setImgPos({ x: 0, y: 0 });
											}}
										>
											100%
										</button>
										<button type="button" className="sub-btn" onClick={fitToFrame}>
											枠に合わせる
										</button>
										<span className="zoom-percent-tag">{(imgZoom * 100).toFixed(0)}%</span>
									</div>
								</div>
							</div>

							<div
								className="fixed-crop-stage"
								onMouseDown={handleFixedCropMouseDown}
								onMouseMove={handleFixedCropMouseMove}
								onMouseUp={handleFixedCropMouseUp}
								onMouseLeave={handleFixedCropMouseUp}
								onTouchStart={handleFixedCropTouchStart}
								onTouchMove={handleFixedCropTouchMove}
								onTouchEnd={handleFixedCropMouseUp}
								onWheel={handleFixedCropWheel}
							>
								{previewUrls[0] ? (
									<>
										<img
											ref={fixedCropImgRef}
											src={previewUrls[0]}
											alt="Fixed crop subject"
											draggable={false}
											className="fixed-crop-movable-img"
											style={{
												transform: `translate(calc(-50% + ${imgPos.x}px), calc(-50% + ${
													imgPos.y
												}px)) scale(${imgZoom * fixedDisplayScale})`,
											}}
										/>

										<div
											className="fixed-crop-cut-box"
											style={{
												width: `${fixedDisplayW}px`,
												height: `${fixedDisplayH}px`,
											}}
										>
											<div className="fixed-crop-grid-line h-line" />
											<div className="fixed-crop-grid-line v-line" />
											<div className="fixed-crop-size-tag">
												{currentFrameW} × {currentFrameH} px
											</div>
										</div>
									</>
								) : (
									<p className="no-preview-text">画像をアップロードしてください。</p>
								)}
							</div>

							<div style={{ marginTop: '20px' }}>
								<button
									className="exec-button"
									disabled={isLoading || selectedFiles.length === 0}
									onClick={handleFixedCropExecute}
								>
									枠に合わせて切り取る ({currentFrameW} × {currentFrameH} px)
								</button>
							</div>
						</div>
					)}

					{/* ⑧ PSD & AI プレビュー UI（DOM衝突回避の独立マウント設計） */}
					{activeMode === 'psd-ai-preview' && (
						<div>
							<div
								style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
							>
								<h3>PSD & AI プレビュー（ブラウザ内解析）</h3>
								<button
									type="button"
									className="sub-btn"
									onClick={() => setIsInfoModalOpen(true)}
									style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
								>
									ℹ️ 仕様と仕組み
								</button>
							</div>
							<p>
								サーバーにファイルを送信せず、ブラウザ（JavaScript）のみで Photoshop / Illustrator
								データを即座に安全プレビューします。
							</p>

							{psdAiFileInfo && (
								<div className="file-info-box">
									<p>
										<strong>ファイル名:</strong> {psdAiFileInfo.name}
									</p>
									<p>
										<strong>サイズ:</strong> {psdAiFileInfo.size}
									</p>
									<p>
										<strong>解析ステータス:</strong>{' '}
										<span style={{ color: '#0070f3', fontWeight: 'bold' }}>{psdAiStatus}</span>
									</p>
								</div>
							)}

							{psdAiNotice && (
								<div className="notice-banner" dangerouslySetInnerHTML={{ __html: psdAiNotice }} />
							)}

							{/* プレビュー表示切替（AIで両方抽出できた場合） */}
							{hasBothViews && (
								<div
									style={{
										display: 'flex',
										gap: '10px',
										justifyContent: 'center',
										marginBottom: '14px',
									}}
								>
									<button
										type="button"
										className={`format-btn ${psdAiViewMode === 'thumb' ? 'selected' : ''}`}
										onClick={() => {
											setPsdAiViewMode('thumb');
											resetPsdAiZoomPan();
										}}
									>
										🖼️ サムネイル表示
									</button>
									<button
										type="button"
										className={`format-btn ${psdAiViewMode === 'canvas' ? 'selected' : ''}`}
										onClick={() => {
											setPsdAiViewMode('canvas');
											resetPsdAiZoomPan();
										}}
									>
										📄 PDF描画表示
									</button>
								</div>
							)}

							{/* ズーム・パン コントロール */}
							{psdAiViewMode && (
								<div
									style={{
										display: 'flex',
										alignItems: 'center',
										justifyContent: 'center',
										gap: '8px',
										marginBottom: '14px',
									}}
								>
									<button
										type="button"
										className="sub-btn"
										onClick={() =>
											setPsdAiZoom((z) => Math.max(0.1, parseFloat((z - 0.2).toFixed(2))))
										}
									>
										➖ 縮小
									</button>
									<button type="button" className="sub-btn" onClick={resetPsdAiZoomPan}>
										100% (リセット)
									</button>
									<button
										type="button"
										className="sub-btn"
										onClick={() =>
											setPsdAiZoom((z) => Math.min(5.0, parseFloat((z + 0.2).toFixed(2))))
										}
									>
										➕ 拡大
									</button>
									<span className="zoom-percent-tag">{(psdAiZoom * 100).toFixed(0)}%</span>
									<span style={{ fontSize: '12px', color: '#666', marginLeft: '6px' }}>
										※ホイール拡縮・ドラッグ移動対応
									</span>
								</div>
							)}

							{/* プレビュー表示ステージ */}
							<div
								ref={psdAiStageRef}
								className="checkerboard psd-ai-preview-stage"
								onMouseDown={handlePsdAiMouseDown}
							>
								{!psdAiViewMode && (
									<p className="no-preview-text">PSDまたはAIファイルをドロップしてください。</p>
								)}
								{/* 生DOM（Canvas/Image）専用の独立マウント先 */}
								<div
									ref={psdAiMountRef}
									style={{
										display: psdAiViewMode ? 'flex' : 'none',
										width: '100%',
										height: '100%',
										justifyContent: 'center',
										alignItems: 'center',
										pointerEvents: 'none',
									}}
								/>
							</div>
						</div>
					)}

					{/* ①〜⑦用の共通アクションボタン */}
					{activeMode !== 'fixed-crop' && activeMode !== 'psd-ai-preview' && (
						<div className="action-area">
							<button
								className="exec-button"
								disabled={isLoading || selectedFiles.length === 0}
								onClick={handleExecute}
							>
								{isLoading
									? '処理を実行中...'
									: activeMode === 'remove-bg'
										? '背景透過を実行してダウンロード'
										: '処理を実行してダウンロード'}
							</button>
						</div>
					)}

					{statusMessage && <div className="status-banner success">{statusMessage}</div>}
					{errorMessage && <div className="status-banner error">{errorMessage}</div>}
				</section>
			</main>

			{/* ⑧ PSD & AI 仕様モーダル */}
			{isInfoModalOpen && (
				<div className="modal-overlay" onClick={() => setIsInfoModalOpen(false)}>
					<div className="modal-content" onClick={(e) => e.stopPropagation()}>
						<button className="close-btn" onClick={() => setIsInfoModalOpen(false)}>
							&times;
						</button>
						<h2>PSD & AI Previewer の仕様と仕組み</h2>
						<div className="modal-body">
							<h3>1. Illustrator (.ai) ファイルの処理</h3>
							<p>AIファイルは保存状態によって中身が異なるため、以下の順で解析を試みます。</p>
							<ul>
								<li>
									<strong>PDFレンダリング:</strong>{' '}
									「PDF互換ファイルを作成」がONの場合、内部のPDFデータを高品質にベクター描画します。
								</li>
								<li>
									<strong>XMPサムネイル:</strong>{' '}
									PDFデータがない場合、内部メタデータ（Base64）に保存されているプレビュー用画像を表示します。
								</li>
								<li>
									<strong>旧形式 (Illustrator 8 以前):</strong>{' '}
									1998年以前の旧形式の場合、ファイル内の特殊な16進数データ（HEX/RLE圧縮）を読み解いて復元します。
								</li>
							</ul>

							<h3>2. Photoshop (.psd) ファイルの処理</h3>
							<p>複雑なレイヤー効果による処理落ちを防ぐため、安全な読み込みを行います。</p>
							<ul>
								<li>
									<strong>統合画像の読み込み:</strong>{' '}
									レイヤーの分解をスキップし、Photoshopが生成する「1枚の統合プレビュー画像」を優先して抽出・描画します。
								</li>
								<li>
									<strong>バイナリスキャン:</strong>{' '}
									解析自体が失敗した場合、データ構造を直接スキャンして埋め込みJPEG画像を強制抽出します。
								</li>
							</ul>

							<h3>3. 操作方法</h3>
							<ul>
								<li>
									<strong>拡大・縮小:</strong> マウスホイール回転、または上部の「➕」「➖」ボタン。
								</li>
								<li>
									<strong>移動 (パン):</strong> 画像上をクリックしたままドラッグ。
								</li>
							</ul>
							<hr style={{ margin: '16px 0', border: 'none', borderTop: '1px solid #eee' }} />
							<p style={{ fontSize: '12px', color: '#777' }}>
								※PDF互換機能がOFFのAIファイルや極端に古いファイルは、ベクターデータではなく簡易サムネイル画像が表示されるため、一部が粗く見えたり欠けたりする場合があります。
							</p>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
