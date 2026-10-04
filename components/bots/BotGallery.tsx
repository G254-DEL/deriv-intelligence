import { BotGalleryCard, type GalleryCardState } from "@/components/bots/BotGalleryCard";
import { FREE_BOT_GALLERY, type FreeBotGalleryItem } from "@/components/bots/free-bots-catalog";

export function BotGallery({
  loadedPresetId,
  cardState,
  onLoad,
}: {
  loadedPresetId: string;
  cardState: (item: FreeBotGalleryItem) => GalleryCardState;
  onLoad: (presetId: string) => void;
}) {
  return (
    <>
      <style>{`
        .free-bot-gallery {
          display: grid;
          width: 100%;
          max-width: 360px;
          min-width: 0;
          align-self: start;
          align-items: start;
          gap: 16px;
          grid-template-columns: minmax(0, 1fr);
        }
        @media (min-width: 768px) {
          .free-bot-gallery {
            max-width: 736px;
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }
        @media (min-width: 1280px) {
          .free-bot-gallery {
            display: grid;
            width: 100%;
            max-width: 1112px;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 16px;
            align-items: start;
          }
        }
      `}</style>
      <div className="free-bot-gallery">
      {FREE_BOT_GALLERY.map((item) => (
        <BotGalleryCard
          key={item.galleryId}
          item={item}
          state={{
            ...cardState(item),
            loaded: loadedPresetId === item.galleryId,
          }}
          onLoad={() => onLoad(item.galleryId)}
        />
      ))}
      </div>
    </>
  );
}
