import { getCraftToken } from '../auth/craft-token';
import { CraftApi, type ProfileResponse, getTeamIdFromProfile } from '../clients/craftApi';

const FREE_TIER = ['Free', 'free', 'V2_Free', 'v2_free'];
const LIVE_PRICE_ID = 'price_1SdYeKCYYgB1lx2ucPn5ZPlL';

function getSuccessUrl(params: { teamId: string, spaceId: string, go: string }) {
  const { teamId, spaceId, go } = params;
  let result = `https://docs.craft.do/s/${encodeURIComponent(spaceId)}/all?_appVersion=aitopup&teamId=${encodeURIComponent(teamId)}`;
  if (go) {
    result += `&go=${encodeURIComponent(go)}`;
  }
  return result;
}

function getSubscriptionPriceId(params: { teamId: string, spaceId: string }) {
  const { teamId, spaceId } = params;
  return {
    priceId: LIVE_PRICE_ID,
    successUrl: getSuccessUrl({ teamId, spaceId, go: 'checkout-success' }),
    cancelUrl: getSuccessUrl({ teamId, spaceId, go: 'checkout-cancel' }),
    environment: 'live' as const,
    country: 'US',
    locale: 'en-US',
  };
}

export async function checkSubscription(profile: ProfileResponse): Promise<string | null> {
  const teamId = getTeamIdFromProfile(profile);
  const team = profile.teams.find(team => team.id === teamId);
  if (!team || !teamId) {
    throw new Error(`Team ${teamId} not found in profile`);
  }
  if (!FREE_TIER.includes(team.tier ?? "free")) {
    return null;
  }
  const space = profile.spaces.find(space => space.teamId === teamId);
  if (!space) {
    throw new Error(`Space for team ${teamId} not found in profile`);
  }
  const { priceId, successUrl, cancelUrl, environment, country, locale } = getSubscriptionPriceId({ teamId, spaceId: space.id });
  const craftApi = new CraftApi();
  const authToken = await getCraftToken();
  const result = await craftApi.createStripeCheckout({ authToken, priceId, teamId, successUrl, cancelUrl, environment, country, locale });
  return result.checkoutUrl;
}
