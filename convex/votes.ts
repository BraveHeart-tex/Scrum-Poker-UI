import { v } from 'convex/values';

import { ApplicationError, ERROR_CODES } from '../shared/errorCodes';
import { api } from './_generated/api';
import { mutation } from './_generated/server';

export const castVote = mutation({
  args: {
    roomId: v.id('rooms'),
    value: v.string(),
  },
  handler: async (ctx, args) => {
    const userIdentity = await ctx.auth.getUserIdentity();
    if (userIdentity === null) {
      throw new ApplicationError({
        code: ERROR_CODES.UNAUTHORIZED,
        message: "'Must be logged in to vote'",
      });
    }

    const room = await ctx.db.get(args.roomId);
    if (!room) {
      throw new ApplicationError({
        code: ERROR_CODES.NOT_FOUND,
        message: 'Room not found',
      });
    }

    // Check if user is a participant
    const participant = await ctx.db
      .query('participants')
      .withIndex('by_room_and_user', (q) =>
        q.eq('roomId', args.roomId).eq('userId', userIdentity.userId as string)
      )
      .unique();

    if (!participant) {
      throw new ApplicationError({
        code: ERROR_CODES.FORBIDDEN,
        message: 'Must be a room participant to vote',
      });
    }

    // Check if user already voted
    const existingVote = await ctx.db
      .query('votes')
      .withIndex('by_room_and_user', (q) =>
        q.eq('roomId', args.roomId).eq('userId', userIdentity.userId as string)
      )
      .unique();

    if (existingVote) {
      // Update existing vote
      await ctx.db.patch(existingVote._id, {
        value: args.value,
      });
    } else {
      // Create new vote
      await ctx.db.insert('votes', {
        roomId: args.roomId,
        userId: userIdentity.userId as string,
        value: args.value,
      });
    }
  },
});

export const deleteVotes = mutation({
  args: {
    roomId: v.id('rooms'),
  },
  handler: async (ctx, args) => {
    const userIdentity = await ctx.auth.getUserIdentity();
    if (userIdentity === null) {
      throw new ApplicationError({
        code: ERROR_CODES.UNAUTHORIZED,
        message: 'You must be logged in to perform this action',
      });
    }

    const room = await ctx.db.get(args.roomId);
    if (!room) {
      throw new ApplicationError({
        code: ERROR_CODES.NOT_FOUND,
        message: 'Room not found',
      });
    }

    const roomSettings = await ctx.runQuery(
      api.roomSettings.getRoomSettingsByRoomId,
      {
        roomId: room._id,
      }
    );

    if (
      !roomSettings.allowOthersToDeleteVotes &&
      room.ownerId !== userIdentity.userId
    ) {
      throw new ApplicationError({
        code: ERROR_CODES.FORBIDDEN,
        message: 'You do not have permission to delete votes',
      });
    }

    const votes = await ctx.db
      .query('votes')
      .withIndex('by_room', (q) => q.eq('roomId', args.roomId))
      .collect();

    await Promise.all([
      ctx.db.patch(room._id, {
        votesRevealed: false,
      }),
      ...votes.map((vote) => ctx.db.delete(vote._id)),
    ]);
  },
});
