// `import "server-only"` is a build-time tripwire: the real package throws if a
// module is pulled into a client bundle. Vitest is neither, so it would throw
// for no reason. This empty module stands in. (The app doesn't import it
// today; the alias is here so adding it later doesn't break the suites.)
export {};
