// 图片预览组件 — 多图网格，发送前预览
import type { ImageData } from '../store/gameState';

interface ChatImagePreviewProps {
  images: Array<{ image: ImageData; fileName: string }>;
  onRemove: (index: number) => void;
}

export function ChatImagePreview({ images, onRemove }: ChatImagePreviewProps) {
  if (images.length === 0) return null;

  return (
    <div className="px-3 py-2 border-t-2 border-indigo-900/50">
      {/* 多图网格 */}
      <div className="flex flex-wrap gap-2">
        {images.map(({ image, fileName }, index) => (
          <div key={index} className="relative group">
            {/* 图片缩略图 */}
            <img
              src={image.data_url}
              alt={fileName || `图片${index + 1}`}
              className="h-14 w-auto rounded-lg border-2 border-indigo-700 object-contain bg-gray-800/50"
            />

            {/* 删除按钮 — 悬停显示 */}
            <button
              onClick={() => onRemove(index)}
              className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-red-600 text-white text-[10px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-lg"
              title="移除图片"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {/* 统计信息 */}
      <div className="mt-1 flex items-center gap-2 text-[8px] text-gray-500">
        <span>{images.length} 张图片</span>
        <span>
          {images.reduce((acc, { image }) => acc + image.width * image.height, 0) / 1_000_000 > 1
            ? `${(images.reduce((acc, { image }) => acc + image.width * image.height, 0) / 1_000_000).toFixed(1)}Mpx`
            : `${(images.reduce((acc, { image }) => acc + image.width * image.height, 0) / 1_000).toFixed(0)}Kpx`}
        </span>
      </div>
    </div>
  );
}
