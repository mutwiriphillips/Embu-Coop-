import Photo from "./Photo";

// Sign-in pages: the form on the right, a farm photograph down the left side
// on laptops and larger. (On phones the form has the whole screen: a photo
// would only push it down and the source pictures are not wide enough to be
// stretched across a full phone width without softening.)
export default function AuthShell({ photo, children }) {
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[420px_1fr] xl:grid-cols-[480px_1fr]">
      <div className="relative hidden bg-kenya-black lg:block">
        <Photo id={photo} priority sizes="(min-width:1280px) 480px, 420px" className="absolute inset-0 h-full w-full" />
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-kenya-black/80 to-transparent p-6 pt-24">
          <p className="text-sm font-bold text-white">National Cooperative Management &amp; Governance System</p>
          <p className="text-xs text-gray-200">State Department for Co-operatives · Republic of Kenya</p>
        </div>
      </div>
      <div className="flex min-h-screen items-center justify-center bg-kenya-green/5 px-4 py-10">{children}</div>
    </div>
  );
}
