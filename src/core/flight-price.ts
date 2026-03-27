import type { FlightPriceQuery, FlightPriceTarget } from '../types/index.js';

const CABIN_CLASS_MAP: Record<NonNullable<FlightPriceQuery['cabinClass']>, string> = {
  economy: 'economy',
  'premium-economy': 'premiumeconomy',
  business: 'business',
  first: 'first',
};

function formatSkyscannerDateSegment(value: string): string {
  const [year, month, day] = value.split('-');
  return `${year.slice(-2)}${month}${day}`;
}

export function buildSkyscannerUrl(query: FlightPriceQuery): string {
  const pathSegments = [
    query.origin.toLowerCase(),
    query.destination.toLowerCase(),
    formatSkyscannerDateSegment(query.departureDate),
  ];

  if (query.returnDate) {
    pathSegments.push(formatSkyscannerDateSegment(query.returnDate));
  }

  const params = new URLSearchParams({
    adultsv2: String(query.adults),
    children: String(query.children ?? 0),
    cabinclass: CABIN_CLASS_MAP[query.cabinClass ?? 'economy'],
    currency: query.currency ?? 'KRW',
    market: 'KR',
    locale: 'ko-KR',
  });

  if (query.directOnly) {
    params.set('preferdirects', 'true');
  }

  if (query.airlines && query.airlines.length > 0) {
    params.set('airlines', query.airlines.join(','));
  }

  return `https://www.skyscanner.co.kr/transport/flights/${pathSegments.join('/')}/?${params.toString()}`;
}

export function resolveFlightTargetUrl(target: FlightPriceTarget): string {
  return target.urlInput || buildSkyscannerUrl(target.priceQuery);
}

export function formatCurrencyValue(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('ko-KR', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${currency} ${Math.round(value).toLocaleString('ko-KR')}`;
  }
}

export function formatFlightQuerySummary(query: FlightPriceQuery): string {
  const route = `${query.origin} → ${query.destination}`;
  const travelDates = query.returnDate
    ? `${query.departureDate} ~ ${query.returnDate}`
    : `${query.departureDate} 편도`;
  const passengers = `성인 ${query.adults}명`;
  const direct = query.directOnly ? '직항' : '경유 포함';
  const airlines = query.airlines && query.airlines.length > 0
    ? `항공사 ${query.airlines.join('/')}`
    : '항공사 전체';

  return `${route} | ${travelDates} | ${passengers} | ${direct} | ${airlines}`;
}
