/**
 * The app's icon set: Heroicons, solid, under names that say what they're for.
 * Each takes a `size` in px and draws the cut Heroicons made for that size:
 * micro (16px grid) up to 16, mini (20px grid) up to 20, the 24px set above.
 */
import * as S16 from "@heroicons/react/16/solid";
import * as S20 from "@heroicons/react/20/solid";
import * as S24 from "@heroicons/react/24/solid";
import type { ComponentType, SVGProps } from "react";

type HeroIcon = ComponentType<SVGProps<SVGSVGElement>>;
export type IconProps = Omit<SVGProps<SVGSVGElement>, "ref"> & { size?: number | string };
export type Icon = ComponentType<IconProps>;

function icon(large: HeroIcon, mini: HeroIcon, micro: HeroIcon): Icon {
  // `fill` and `strokeWidth` are accepted for call-site compatibility; solid
  // icons are filled shapes, so neither applies.
  function AppIcon({ size = 24, fill: _fill, strokeWidth: _stroke, ...rest }: IconProps) {
    const px = typeof size === "number" ? size : 24;
    const Cut = px <= 16 ? micro : px <= 20 ? mini : large;
    return <Cut width={size} height={size} aria-hidden {...rest} />;
  }
  return AppIcon;
}

export const AlertCircle = icon(S24.ExclamationCircleIcon, S20.ExclamationCircleIcon, S16.ExclamationCircleIcon);
export const ArrowUp = icon(S24.ArrowUpIcon, S20.ArrowUpIcon, S16.ArrowUpIcon);
export const ArrowUpRight = icon(S24.ArrowUpRightIcon, S20.ArrowUpRightIcon, S16.ArrowUpRightIcon);
export const ArrowLeft =icon(S24.ArrowLeftIcon, S20.ArrowLeftIcon, S16.ArrowLeftIcon);
export const Backspace = icon(S24.BackspaceIcon, S20.BackspaceIcon, S16.BackspaceIcon);
export const Captions = icon(S24.ChatBubbleBottomCenterTextIcon, S20.ChatBubbleBottomCenterTextIcon, S16.ChatBubbleBottomCenterTextIcon);
export const Check = icon(S24.CheckIcon, S20.CheckIcon, S16.CheckIcon);
export const ChevronDown = icon(S24.ChevronDownIcon, S20.ChevronDownIcon, S16.ChevronDownIcon);
export const ChevronLeft = icon(S24.ChevronLeftIcon, S20.ChevronLeftIcon, S16.ChevronLeftIcon);
export const ChevronRight = icon(S24.ChevronRightIcon, S20.ChevronRightIcon, S16.ChevronRightIcon);
export const Close = icon(S24.XMarkIcon, S20.XMarkIcon, S16.XMarkIcon);
export const Controls = icon(S24.CommandLineIcon, S20.CommandLineIcon, S16.CommandLineIcon);
export const Desktop = icon(S24.ComputerDesktopIcon, S20.ComputerDesktopIcon, S16.ComputerDesktopIcon);
export const Edit = icon(S24.PencilIcon, S20.PencilIcon, S16.PencilIcon);
export const Episodes = icon(S24.RectangleStackIcon, S20.RectangleStackIcon, S16.RectangleStackIcon);
export const ExitFullscreen = icon(S24.ArrowsPointingInIcon, S20.ArrowsPointingInIcon, S16.ArrowsPointingInIcon);
export const Fullscreen = icon(S24.ArrowsPointingOutIcon, S20.ArrowsPointingOutIcon, S16.ArrowsPointingOutIcon);
export const Grid = icon(S24.Squares2X2Icon, S20.Squares2X2Icon, S16.Squares2X2Icon);
export const Hidden = icon(S24.EyeSlashIcon, S20.EyeSlashIcon, S16.EyeSlashIcon);
export const Info = icon(S24.InformationCircleIcon, S20.InformationCircleIcon, S16.InformationCircleIcon);
export const Download = icon(S24.ArrowDownTrayIcon, S20.ArrowDownTrayIcon, S16.ArrowDownTrayIcon);
export const Instant =icon(S24.BoltIcon, S20.BoltIcon, S16.BoltIcon);
export const LayoutList = icon(S24.ListBulletIcon, S20.ListBulletIcon, S16.ListBulletIcon);
export const LayoutRow = icon(S24.ViewColumnsIcon, S20.ViewColumnsIcon, S16.ViewColumnsIcon);
export const Lock = icon(S24.LockClosedIcon, S20.LockClosedIcon, S16.LockClosedIcon);
export const Minus = icon(S24.MinusIcon, S20.MinusIcon, S16.MinusIcon);
export const More = icon(S24.EllipsisHorizontalIcon, S20.EllipsisHorizontalIcon, S16.EllipsisHorizontalIcon);
export const Warning = icon(S24.ExclamationTriangleIcon, S20.ExclamationTriangleIcon, S16.ExclamationTriangleIcon);
export const Pause = icon(S24.PauseIcon, S20.PauseIcon, S16.PauseIcon);
export const Picture = icon(S24.PhotoIcon, S20.PhotoIcon, S16.PhotoIcon);
export const PlaylistIcon = icon(S24.ListBulletIcon, S20.ListBulletIcon, S16.ListBulletIcon);
export const Play =icon(S24.PlayIcon, S20.PlayIcon, S16.PlayIcon);
export const Plus = icon(S24.PlusIcon, S20.PlusIcon, S16.PlusIcon);
export const Power = icon(S24.PowerIcon, S20.PowerIcon, S16.PowerIcon);
export const Profile = icon(S24.UserCircleIcon, S20.UserCircleIcon, S16.UserCircleIcon);
export const Puzzle = icon(S24.PuzzlePieceIcon, S20.PuzzlePieceIcon, S16.PuzzlePieceIcon);
export const Reset = icon(S24.ArrowUturnLeftIcon, S20.ArrowUturnLeftIcon, S16.ArrowUturnLeftIcon);
export const Search = icon(S24.MagnifyingGlassIcon, S20.MagnifyingGlassIcon, S16.MagnifyingGlassIcon);
export const Services = icon(S24.CloudIcon, S20.CloudIcon, S16.CloudIcon);
export const Settings = icon(S24.Cog6ToothIcon, S20.Cog6ToothIcon, S16.Cog6ToothIcon);
export const SignOut = icon(S24.ArrowRightStartOnRectangleIcon, S20.ArrowRightStartOnRectangleIcon, S16.ArrowRightStartOnRectangleIcon);
export const Store = icon(S24.BuildingStorefrontIcon, S20.BuildingStorefrontIcon, S16.BuildingStorefrontIcon);
export const Star = icon(S24.StarIcon, S20.StarIcon, S16.StarIcon);
export const OpenFile = icon(S24.ArrowUpTrayIcon, S20.ArrowUpTrayIcon, S16.ArrowUpTrayIcon);
export const Folder = icon(S24.FolderOpenIcon, S20.FolderOpenIcon, S16.FolderOpenIcon);
export const Bookmark =icon(S24.BookmarkIcon, S20.BookmarkIcon, S16.BookmarkIcon);
export const Calendar =icon(S24.CalendarDaysIcon, S20.CalendarDaysIcon, S16.CalendarDaysIcon);
export const SkipForward = icon(S24.ForwardIcon, S20.ForwardIcon, S16.ForwardIcon);
export const Sources = icon(S24.QueueListIcon, S20.QueueListIcon, S16.QueueListIcon);
export const Speed = icon(S24.ClockIcon, S20.ClockIcon, S16.ClockIcon);
export const Trash = icon(S24.TrashIcon, S20.TrashIcon, S16.TrashIcon);
export const Trailer = icon(S24.FilmIcon, S20.FilmIcon, S16.FilmIcon);
export const Tv = icon(S24.TvIcon, S20.TvIcon, S16.TvIcon);
// AirPlay: sending what plays to a TV (not Apple's own glyph).
export const Cast = icon(S24.TvIcon, S20.TvIcon, S16.TvIcon);
export const Filters = icon(S24.AdjustmentsHorizontalIcon, S20.AdjustmentsHorizontalIcon, S16.AdjustmentsHorizontalIcon);
export const Fire =icon(S24.FireIcon, S20.FireIcon, S16.FireIcon);
export const Watched = icon(S24.CheckCircleIcon, S20.CheckCircleIcon, S16.CheckCircleIcon);
export const Users = icon(S24.UsersIcon, S20.UsersIcon, S16.UsersIcon);
export const WatchParty = icon(S24.UserGroupIcon, S20.UserGroupIcon, S16.UserGroupIcon);
export const Volume = icon(S24.SpeakerWaveIcon, S20.SpeakerWaveIcon, S16.SpeakerWaveIcon);
export const VolumeMuted = icon(S24.SpeakerXMarkIcon, S20.SpeakerXMarkIcon, S16.SpeakerXMarkIcon);

/** A game controller, drawn solid to sit with the Heroicons (which have none). */
export function Gamepad({ size = 24, fill: _fill, strokeWidth: _stroke, ...rest }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden {...rest}>
      <path
        fillRule="evenodd"
        d="M7.6 5.5h8.8a4.9 4.9 0 0 1 4.8 3.95l1.05 5.35a3.05 3.05 0 0 1-5.35 2.5L15.2 15.2H8.8l-1.7 2.1a3.05 3.05 0 0 1-5.35-2.5L2.8 9.45A4.9 4.9 0 0 1 7.6 5.5ZM7.75 8.5a.75.75 0 0 0-.75.75V10.5H5.75a.75.75 0 0 0 0 1.5H7v1.25a.75.75 0 0 0 1.5 0V12h1.25a.75.75 0 0 0 0-1.5H8.5V9.25a.75.75 0 0 0-.75-.75Zm8.5.25a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm-1.75 2.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm3.5 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z"
      />
    </svg>
  );
}
