// The Angular jest builder (@angular-builders/jest) already loads
// jest-preset-angular/setup-jest before this file, so it is not imported here.

/**
 * jsdom does not implement matchMedia, which the sidebar uses to collapse
 * itself on small screens. Stubbing it here keeps every spec from having to.
 */
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }),
});

// Deterministic storage between specs: the token service reads localStorage on
// construction, so leaking a token from one spec into the next would be a
// genuinely confusing failure.
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
